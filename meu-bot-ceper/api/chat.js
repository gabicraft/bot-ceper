// api/chat.js
const fs = require('fs');
const path = require('path');

// Carrega a base de conhecimento
function loadBase() {
    const basePath = path.join(process.cwd(), 'base_conhecimento.txt');
    try {
        return fs.readFileSync(basePath, 'utf-8');
    } catch (err) {
        console.error('Erro ao ler base:', err);
        return 'BASE DE CONHECIMENTO INDISPONÍVEL.';
    }
}

// Monta o prompt completo
function buildPrompt(question) {
    const baseContent = loadBase();
    return `
Você é um assistente especialista da Central de Perícias (CEPER). Use APENAS as informações da base de conhecimento abaixo para responder à pergunta do usuário.

BASE DE CONHECIMENTO:
${baseContent}

PERGUNTA DO USUÁRIO:
${question}

REGRAS:
- Responda de forma clara, objetiva e direta.
- Se a base não tiver a informação, diga "Não encontrei essa informação na base da CEPER."
- Quando citar um modelo de certidão, destaque com **negrito**.
- Cite o item ou a data da regra quando disponível.
- Mantenha o tom profissional, como um servidor auxiliando um colega.
`;
}

// Função para chamar a DeepSeek
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
        } catch (_) { /* ignore */ }
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
    // Aceita apenas POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido. Use POST.' });
    }

    const { question } = req.body;
    if (!question || typeof question !== 'string' || question.trim().length === 0) {
        return res.status(400).json({ error: 'Pergunta inválida ou vazia.' });
    }

    // Limita o tamanho da pergunta para evitar abusos
    if (question.trim().length > 800) {
        return res.status(400).json({ error: 'A pergunta é muito longa (máximo 800 caracteres).' });
    }

    // Chave da API deve estar nas variáveis de ambiente
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

        // Se for erro de saldo (402), mensagem específica
        const errorMsg = err.message || 'Erro interno no servidor.';
        if (errorMsg.includes('402') || errorMsg.toLowerCase().includes('insufficient balance')) {
            return res.status(402).json({
                error: 'Saldo insuficiente na API. Recarregue a conta da DeepSeek.'
            });
        }

        return res.status(500).json({ error: 'Erro ao processar sua solicitação.' });
    }
};