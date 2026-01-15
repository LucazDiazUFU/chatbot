const qrcode = require('qrcode-terminal');
const express = require('express');
const cors = require('cors');
const { Client, LocalAuth } = require('whatsapp-web.js');

// ===== CONFIGURAÇÃO DO CLIENTE WHATSAPP =====
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
    ],
  },
});



// ===== EVENTOS DO CLIENTE WHATSAPP =====
client.on('qr', qr => {
  console.log('\n=== QR CODE PARA CONEXÃO ===');
  qrcode.generate(qr, { small: true });
  console.log('Escaneie o QR Code acima com o WhatsApp\n');
});

client.on('ready', () => {
  console.log('✅ Bot conectado ao WhatsApp com sucesso!');
  console.log('📱 Pronto para receber requisições\n');
});

client.on('authenticated', () => {
  console.log('🔐 Autenticação realizada');
});

client.on('auth_failure', msg => {
  console.error('❌ Falha na autenticação:', msg);
});

client.on('disconnected', (reason) => {
  console.log('⚠️ Bot desconectado. Motivo:', reason);
  console.log('🔄 Tentando reconectar...');
  setTimeout(() => {
    client.initialize();
  }, 5000);
});

// Inicializa o cliente
client.initialize();

// ===== FUNÇÕES AUXILIARES =====

/**
 * Formata horário ISO para formato legível (HH:MM)
 */
function formatarHorario(isoString) {
  try {
    const data = new Date(isoString);
    if (isNaN(data.getTime())) {
      console.warn('⚠️ Data inválida recebida:', isoString);
      return isoString;
    }
    const h = String(data.getHours()).padStart(2, '0');
    const m = String(data.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  } catch (error) {
    console.error('❌ Erro ao formatar horário:', error);
    return isoString;
  }
}

/**
 * Resolve o ChatID do WhatsApp a partir de um número E.164
 * Tenta diferentes variações do número se necessário
 */
async function resolveChatId(numeroE164) {
  try {
    // Remove caracteres não numéricos
    const numeroLimpo = numeroE164.replace(/\D/g, '');
    
    if (!numeroLimpo || numeroLimpo.length < 10) {
      console.warn('⚠️ Número inválido:', numeroE164);
      return null;
    }

    // Tenta encontrar o ID diretamente
    const id = await client.getNumberId(numeroLimpo);
    if (id && id._serialized) {
      console.log('✅ ChatID encontrado para:', numeroLimpo);
      return id._serialized;
    }

    // Se não encontrou e o número tem 13 dígitos (55 + DDD + número com 9)
    const body = numeroLimpo.slice(2); // Remove código do país (55)
    if (body.length === 11 && body[2] === '9') {
      // Tenta sem o 9 (número antigo)
      const alt = '55' + body.slice(0, 2) + body.slice(3);
      console.log('🔄 Tentando variação do número:', alt);
      const id2 = await client.getNumberId(alt);
      if (id2 && id2._serialized) {
        console.log('✅ ChatID encontrado para variação:', alt);
        return id2._serialized;
      }
    }
    
    console.warn('⚠️ Número não encontrado no WhatsApp:', numeroLimpo);
    return null;
  } catch (error) {
    console.error('❌ Erro ao resolver ChatID:', error);
    return null;
  }
}

/**
 * Valida se o número está no formato E.164
 */
function validarNumero(numero) {
  if (!numero || typeof numero !== 'string') {
    return false;
  }
  const numeroLimpo = numero.replace(/\D/g, '');
  // Deve ter pelo menos 10 dígitos e começar com código do país
  return numeroLimpo.length >= 10 && numeroLimpo.length <= 15;
}

/**
 * Valida se o horário está em formato ISO válido
 */
function validarHorario(horario) {
  if (!horario || typeof horario !== 'string') {
    return false;
  }
  const data = new Date(horario);
  return !isNaN(data.getTime());
}

// ===== CONFIGURAÇÃO DO EXPRESS =====
const app = express();

// CORS - Permite requisições da API
app.use(cors({
  origin: '*',
  methods: ['POST', 'GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'ngrok-skip-browser-warning', 'User-Agent']
}));

// Parse JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware de log para debug
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] ${req.method} ${req.path}`);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));
  next();
});

// ===== ENDPOINTS =====

/**
 * Endpoint de teste - Verifica se o chatbot está funcionando
 */
app.post('/test', (req, res) => {
  console.log('✅ Endpoint /test chamado');
  res.status(200).json({
    success: true,
    message: 'Chatbot funcionando corretamente',
    timestamp: new Date().toISOString(),
    whatsapp_connected: client.info ? true : false
  });
});

/**
 * Endpoint para enviar notificação de entrada na fila
 */
app.post('/enviarFila', async (req, res) => {
  try {
    console.log('\n=== ENVIAR FILA ===');
    
    const { numero, posicao, horario } = req.body;
    
    // Validação completa dos campos
    if (!numero) {
      console.error('❌ Erro: Número não informado');
      return res.status(400).json({ 
        success: false,
        erro: 'Campo "numero" é obrigatório',
        recebido: req.body 
      });
    }
    
    if (!validarNumero(numero)) {
      console.error('❌ Erro: Número inválido:', numero);
      return res.status(400).json({ 
        success: false,
        erro: 'Formato de número inválido. Use formato E.164 (ex: 5534991234567)',
        numero_recebido: numero 
      });
    }
    
    if (posicao === undefined || posicao === null) {
      console.error('❌ Erro: Posição não informada');
      return res.status(400).json({ 
        success: false,
        erro: 'Campo "posicao" é obrigatório',
        recebido: req.body 
      });
    }
    
    if (typeof posicao !== 'number' || posicao < 0) {
      console.error('❌ Erro: Posição inválida:', posicao);
      return res.status(400).json({ 
        success: false,
        erro: 'Campo "posicao" deve ser um número maior ou igual a 0',
        posicao_recebida: posicao 
      });
    }
    
    if (!horario) {
      console.error('❌ Erro: Horário não informado');
      return res.status(400).json({ 
        success: false,
        erro: 'Campo "horario" é obrigatório',
        recebido: req.body 
      });
    }
    
    if (!validarHorario(horario)) {
      console.error('❌ Erro: Horário inválido:', horario);
      return res.status(400).json({ 
        success: false,
        erro: 'Formato de horário inválido. Use formato ISO 8601',
        horario_recebido: horario 
      });
    }
    
    console.log('📋 Dados validados:', { numero, posicao, horario });
    
    // Resolve o ChatID
    const chatId = await resolveChatId(numero);
    if (!chatId) {
      console.error('❌ Erro: Número não encontrado no WhatsApp');
      return res.status(400).json({ 
        success: false,
        erro: 'Número não registrado no WhatsApp. Certifique-se de que o número está cadastrado e o WhatsApp está conectado.',
        numero: numero 
      });
    }
    
    // Formata a mensagem
    const horarioFormatado = formatarHorario(horario);
    const mensagem =
      `✅ *Você entrou na fila da barbearia!*\n\n` +
      `📍 *Sua posição atual:* ${posicao}\n` +
      `⏰ *Horário previsto:* ${horarioFormatado}\n\n` +
      `Aguarde sua vez. Manteremos você informado até o momento do atendimento.`;
    
    console.log('📤 Enviando mensagem para:', chatId);
    console.log('💬 Mensagem:', mensagem);
    
    // Envia a mensagem
    await client.sendMessage(chatId, mensagem);
    
    console.log('✅ Mensagem enviada com sucesso');
    
    res.status(200).json({ 
      success: true,
      status: 'ok',
      message: 'Mensagem enviada com sucesso',
      numero: numero,
      chatId: chatId
    });
    
  } catch (error) {
    console.error('❌ Erro ao processar /enviarFila:', error);
    res.status(500).json({ 
      success: false,
      erro: error.message || 'Erro interno do servidor',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * Endpoint para agendar aviso de atendimento
 */
app.post('/agendarAviso', async (req, res) => {
  try {
    console.log('\n=== AGENDAR AVISO ===');
    
    const { numero, horario } = req.body;
    
    // Validação completa dos campos
    if (!numero) {
      console.error('❌ Erro: Número não informado');
      return res.status(400).json({ 
        success: false,
        erro: 'Campo "numero" é obrigatório',
        recebido: req.body 
      });
    }
    
    if (!validarNumero(numero)) {
      console.error('❌ Erro: Número inválido:', numero);
      return res.status(400).json({ 
        success: false,
        erro: 'Formato de número inválido. Use formato E.164 (ex: 5534991234567)',
        numero_recebido: numero 
      });
    }
    
    if (!horario) {
      console.error('❌ Erro: Horário não informado');
      return res.status(400).json({ 
        success: false,
        erro: 'Campo "horario" é obrigatório',
        recebido: req.body 
      });
    }
    
    if (!validarHorario(horario)) {
      console.error('❌ Erro: Horário inválido:', horario);
      return res.status(400).json({ 
        success: false,
        erro: 'Formato de horário inválido. Use formato ISO 8601',
        horario_recebido: horario 
      });
    }
    
    console.log('📋 Dados validados:', { numero, horario });
    
    // Resolve o ChatID
    const chatId = await resolveChatId(numero);
    if (!chatId) {
      console.error('❌ Erro: Número não encontrado no WhatsApp');
      return res.status(400).json({ 
        success: false,
        erro: 'Número não registrado no WhatsApp. Certifique-se de que o número está cadastrado e o WhatsApp está conectado.',
        numero: numero 
      });
    }
    
    // Calcula o tempo até 15 minutos antes do horário
    const agora = new Date();
    const atendimento = new Date(horario);
    const diff = atendimento.getTime() - agora.getTime() - (15 * 60000);
    
    if (diff <= 0) {
      console.warn('⚠️ Horário muito próximo, enviando imediatamente');
      // Se já passou ou está muito próximo, envia imediatamente
      const horarioFormatado = formatarHorario(horario);
      const msg =
        `⏰ *Lembrete de Atendimento*\n\n` +
        `Seu atendimento está previsto para *${horarioFormatado}*.\n\n` +
        `Recomendamos que você se dirija para a barbearia.`;
      
      try {
        await client.sendMessage(chatId, msg);
        console.log('✅ Mensagem de aviso enviada imediatamente');
        return res.status(200).json({ 
          success: true,
          status: 'enviado',
          message: 'Aviso enviado imediatamente (horário muito próximo)'
        });
      } catch (err) {
        console.error('❌ Erro ao enviar mensagem imediata:', err);
        return res.status(500).json({ 
          success: false,
          erro: 'Erro ao enviar mensagem: ' + err.message 
        });
      }
    }
    
    // Agenda o envio para 15 minutos antes
    const minutosAteEnvio = Math.floor(diff / 60000);
    console.log(`⏰ Agendando aviso para ${minutosAteEnvio} minutos`);
    
    setTimeout(async () => {
      try {
        const horarioFormatado = formatarHorario(horario);
        const msg =
          `⏰ *Lembrete de Atendimento*\n\n` +
          `Faltam apenas *15 minutos* para seu atendimento às *${horarioFormatado}*.\n\n` +
          `Recomendamos que você comece a se dirigir para a barbearia.`;
        
        console.log('📤 Enviando mensagem agendada para:', chatId);
        await client.sendMessage(chatId, msg);
        console.log('✅ Mensagem agendada enviada com sucesso');
      } catch (err) {
        console.error('❌ Erro ao enviar mensagem agendada:', err);
      }
    }, diff);
    
    console.log('✅ Aviso agendado com sucesso');
    
    res.status(200).json({ 
      success: true,
      status: 'agendado',
      message: `Aviso agendado para ${minutosAteEnvio} minutos`,
      minutos_ate_envio: minutosAteEnvio
    });
    
  } catch (error) {
    console.error('❌ Erro ao processar /agendarAviso:', error);
    res.status(500).json({ 
      success: false,
      erro: error.message || 'Erro interno do servidor',
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Rota catch-all para debug (deve ser a última rota)
app.use((req, res) => {
  console.log('⚠️ Rota não encontrada:', req.method, req.originalUrl);
  res.status(404).json({ 
    success: false,
    erro: 'Rota não encontrada',
    method: req.method,
    path: req.originalUrl,
    rotas_disponiveis: ['/test', '/enviarFila', '/agendarAviso']
  });
});

// ===== INICIALIZAÇÃO DO SERVIDOR =====
const PORT = process.env.PORT || 3000;


app.listen(PORT, () => {
  console.log('\n🚀 ====================================');
  console.log('🤖 Chatbot da Barbearia Pedro');
  console.log('🚀 ====================================');
  console.log(`📡 API rodando na porta ${PORT}`);
  console.log('📋 Endpoints disponíveis:');
  console.log('   POST /test');
  console.log('   POST /enviarFila');
  console.log('   POST /agendarAviso');
  console.log('🚀 ====================================\n');
});

// Tratamento de erros não capturados
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});
