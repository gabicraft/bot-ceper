const fs = require('fs');
const path = require('path');

// Carrega a base de conhecimento
function loadBase() {
    const basePath = path.join(process.cwd(), 'base_conhecimento');
    try {
        return fs.readFileSync(basePath, 'utf-8');
    } catch (err) {
        console.error('Erro ao ler base:', err);
        return 'BASE DE CONHECIMENTO INDISPONÍVEL.';
    }
}

// ============================================================
// FUNÇÃO CORRIGIDA – PRIORIZA RESPOSTAS COMPLETAS E PRÁTICAS
// ============================================================
function buildPrompt(question) {
    const baseContent = loadBase();
    return `
Você é um assistente especialista da Central de Perícias (CEPER). Sua função é ajudar servidores com procedimentos do dia a dia.

BASE DE CONHECIMENTO (TODAS AS REGRAS E MODELOS DE CERTIDÃO):
${baseContent}

PERGUNTA DO USUÁRIO:
${question}

REGRAS OBRIGATÓRIAS PARA SUA RESPOSTA:
1. Sempre priorize as instruções passo a passo da rotina, como se estivesse orientando um colega que está com o sistema aberto na frente dele.
2. Se houver um modelo de certidão aplicável (itens 1 a 19), **transcreva o texto completo do modelo**.
3. Indique claramente o local no sistema (ex: "Acesse Movimentar Processo", "Clique em Perícias", "Vá em Ações", etc.).
4. Se houver prazos (ex: 5 dias, 15 dias), informe-os explicitamente.
5. Se houver localizadores (ex: JULIANA, TA PAGAR PERITO, INTIMAR PARTE SEM ADVOGADO), mencione quais usar e como usá-los.
6. Caso a pergunta não tenha relação com a base, diga "Não encontrei essa informação na base da CEPER."
7. Responda de forma objetiva, direta, sem enfeites, mas com todos os detalhes práticos.
8. Se houver mais de um fluxo possível (ex: primeira falta vs. segunda falta), explique ambos.
`;
}

// Chamada à API DeepSeek
async function callDeepSeek(prompt, apiKey) {
    const url = 'https://api.deepseek.com/v1/chat/completions';
    const payload = {
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 2000,
        stream: false
    };
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        let errorDetail = '';
        try {
            const errData = await response.json();
            errorDetail = errData.error?.message || JSON.stringify(errData);
        } catch (_) {}
        throw new Error(`DeepSeek API erro ${response.status}: ${errorDetail || response.statusText}`);
    }
    const data = await response.json();
    if (!data.choices || data.choices.length === 0) {
        throw new Error('Resposta da API sem conteúdo.');
    }
    return data.choices[0].message.content.trim();
}

// Handler da Vercel
module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido. Use POST.' });
    }
    const { question } = req.body;
    if (!question || typeof question !== 'string' || question.trim().length === 0) {
        return res.status(400).json({ error: 'Pergunta inválida ou vazia.' });
    }
    if (question.trim().length > 800) {
        return res.status(400).json({ error: 'A pergunta é muito longa (máximo 800 caracteres).' });
    }
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
        console.error('Chave API não configurada.');
        return res.status(500).json({ error: 'Chave da API não configurada no servidor.' });
    }
    try {
        const prompt = buildPrompt(question.trim());
        const answer = await callDeepSeek(prompt, apiKey);
        return res.status(200).json({ answer });
    } catch (err) {
        console.error('Erro no backend:', err);
        const errorMsg = err.message || 'Erro interno no servidor.';
        if (errorMsg.includes('402') || errorMsg.toLowerCase().includes('insufficient balance')) {
            return res.status(402).json({
                error: 'Saldo insuficiente na API. Recarregue a conta da DeepSeek.'
            });
        }
        return res.status(500).json({ error: 'Erro ao processar sua solicitação.' });
    }
};
