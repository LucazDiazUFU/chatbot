const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

// ===== CONFIGURAÇÃO DA EVOLUTION API =====
const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;
const INSTANCE_NAME = process.env.INSTANCE_NAME || 'barbearia-pedro';

if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
  console.error('❌ Erro: Configure EVOLUTION_API_URL e EVOLUTION_API_KEY no arquivo .env');
  process.exit(1);
}

// Cliente HTTP para Evolution API
const evolutionClient = axios.create({
  baseURL: EVOLUTION_API_URL,
  headers: {
    'apikey': EVOLUTION_API_KEY,
    'Content-Type': 'application/json'
  }
});

// ===== CONFIGURAÇÃO DO EXPRESS =====
const app = express();

app.use(cors({
  origin: '*',
  methods: ['POST', 'GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'ngrok-skip-browser-warning', 'User-Agent']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware de log
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] ${req.method} ${req.path}`);
  console.log('Body:', JSON.stringify(req.body, null, 2));
  next();
});

// ===== FUNÇÕES AUXILIARES =====

function formatarHorario(isoString) {
  try {
    // CORREÇÃO: Extrai horas e minutos diretamente do ISO string
    // Formato esperado: "2026-01-16T23:00:00-03:00" ou "2026-01-16T23:00:00.000Z"
    // Isso evita problemas de conversão de timezone
    const match = isoString.match(/T(\d{2}):(\d{2})/);
    if (match) {
      // Retorna HH:MM diretamente do ISO string (já está no timezone correto do Brasil)
      return `${match[1]}:${match[2]}`;
    }
    
    // Fallback: usar Date e converter para timezone do Brasil
    const data = new Date(isoString);
    if (isNaN(data.getTime())) {
      console.warn('⚠️ Data inválida recebida:', isoString);
      return isoString;
    }
    
    // Converter para timezone do Brasil
    const opcoes = { 
      timeZone: 'America/Sao_Paulo', 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false
    };
    const formatado = data.toLocaleString('pt-BR', opcoes);
    return formatado; // Retorna "HH:MM"
    
  } catch (error) {
    console.error('❌ Erro ao formatar horário:', error);
    // Tentar extrair apenas HH:MM do string original como último recurso
    const match = isoString.match(/(\d{2}):(\d{2})/);
    return match ? `${match[1]}:${match[2]}` : isoString;
  }
}

function formatarNumero(numeroE164) {
  return numeroE164.replace(/\D/g, '');
}

async function enviarMensagem(numero, mensagem) {
  try {
    const numeroFormatado = formatarNumero(numero);
    
    const response = await evolutionClient.post(`/message/sendText/${INSTANCE_NAME}`, {
      number: numeroFormatado,
      text: mensagem
    });

    if (response.data) {
      console.log('✅ Mensagem enviada:', response.data);
      return { success: true };
    }
  } catch (error) {
    console.error('❌ Erro ao enviar mensagem:', error.response?.data || error.message);
    throw error;
  }
}

async function verificarConexao() {
  try {
    const response = await evolutionClient.get(`/instance/connectionState/${INSTANCE_NAME}`);
    
    // CORREÇÃO: A resposta da Evolution API vem como { instance: { state: 'open' } }
    const state = response.data?.instance?.state || response.data?.state;
    const conectado = state === 'open';
    
    console.log('🔍 Verificação de conexão:', {
      estado: state,
      conectado: conectado,
      resposta_completa: JSON.stringify(response.data)
    });
    
    return conectado;
  } catch (error) {
    console.error('❌ Erro ao verificar conexão:', error.response?.data || error.message);
    // Em caso de erro, retorna false mas loga detalhes
    if (error.response?.data) {
      console.error('📋 Resposta do erro:', JSON.stringify(error.response.data, null, 2));
    }
    return false;
  }
}

// ===== ENDPOINTS =====

app.post('/test', async (req, res) => {
  try {
    const conectado = await verificarConexao();
    res.status(200).json({
      success: true,
      message: 'Chatbot funcionando corretamente',
      timestamp: new Date().toISOString(),
      whatsapp_connected: conectado,
      instance: INSTANCE_NAME
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Erro ao verificar conexão',
      error: error.message
    });
  }
});

app.post('/enviarFila', async (req, res) => {
  try {
    console.log('\n=== ENVIAR FILA ===');
    
    const { numero, posicao, horario, servico_nome, tempo_minutos, tempo_anterior_minutos } = req.body;
    
    if (!numero || posicao === undefined || !horario) {
      return res.status(400).json({ 
        success: false,
        erro: 'Campos obrigatórios: numero, posicao, horario',
        recebido: req.body 
      });
    }
    
    console.log('📋 Dados validados:', { numero, posicao, horario, servico_nome, tempo_minutos, tempo_anterior_minutos });
    
    // Verificar conexão (com tentativa de envio mesmo se a verificação falhar)
    const conectado = await verificarConexao();
    
    if (!conectado) {
      console.warn('⚠️ WhatsApp aparenta não estar conectado, mas tentando enviar mesmo assim...');
      // Não retornamos erro imediatamente, tentamos enviar
      // Se realmente não estiver conectado, o erro virá do evolutionClient
    }
    
    // Função para formatar tempo em horas e minutos
    function formatarTempoMinutos(minutos) {
      if (!minutos || minutos === 0) return '0 min';
      if (minutos < 60) return `${minutos} min`;
      const horas = Math.floor(minutos / 60);
      const mins = minutos % 60;
      if (mins === 0) return `${horas}h`;
      return `${horas}h ${mins}min`;
    }
    
    const horarioFormatado = formatarHorario(horario);
    const servicoNome = servico_nome || 'Serviço';
    const tempoServico = formatarTempoMinutos(tempo_minutos || 30);
    const tempoEspera = tempo_anterior_minutos ? formatarTempoMinutos(tempo_anterior_minutos) : null;
    
    // Monta a mensagem com todas as informações
    let mensagem = `✅ *Você entrou na fila da barbearia!*\n\n`;
    mensagem += `📍 *Sua posição na fila:* ${posicao}º lugar\n`;
    mensagem += `✂️ *Serviço:* ${servicoNome}\n`;
    mensagem += `⏱️ *Tempo estimado do serviço:* ${tempoServico}\n`;
    
    // Adiciona tempo de espera se houver clientes anteriores
    if (tempoEspera && tempo_anterior_minutos > 0) {
      mensagem += `⏳ *Tempo de espera estimado:* ${tempoEspera}\n`;
    }
    
    mensagem += `⏰ *Horário previsto de início:* ${horarioFormatado}\n\n`;
    mensagem += `Aguarde sua vez. Manteremos você informado até o momento do atendimento. 😊`;
    
    console.log('📤 Enviando mensagem para:', numero);
    console.log('💬 Mensagem:', mensagem);
    console.log('🕐 Horário recebido (ISO):', horario);
    console.log('🕐 Horário formatado:', horarioFormatado);
    
    await enviarMensagem(numero, mensagem);
    
    console.log('✅ Mensagem enviada com sucesso');
    
    res.status(200).json({ 
      success: true,
      status: 'ok',
      message: 'Mensagem enviada com sucesso',
      numero: numero
    });
    
  } catch (error) {
    console.error('❌ Erro ao processar /enviarFila:', error);
    const errorMessage = error.response?.data?.message || error.message || 'Erro interno do servidor';
    
    // Se o erro for de conexão, retorna erro específico
    if (error.response?.status === 404 || errorMessage.includes('instance') || errorMessage.includes('connect')) {
      return res.status(503).json({ 
        success: false,
        erro: 'WhatsApp não está conectado. Verifique a instância na Evolution API.',
        detalhes: errorMessage
      });
    }
    
    res.status(500).json({ 
      success: false,
      erro: errorMessage
    });
  }
});

app.post('/agendarAviso', async (req, res) => {
  try {
    console.log('\n=== AGENDAR AVISO ===');
    
    const { numero, horario } = req.body;
    
    if (!numero || !horario) {
      return res.status(400).json({ 
        success: false,
        erro: 'Campos obrigatórios: numero, horario',
        recebido: req.body 
      });
    }
    
    console.log('📋 Dados validados:', { numero, horario });
    
    const agora = new Date();
    const atendimento = new Date(horario);
    const diff = atendimento.getTime() - agora.getTime() - (15 * 60000);
    
    if (diff <= 0) {
      const horarioFormatado = formatarHorario(horario);
      const msg = `⏰ *Lembrete de Atendimento*\n\n` +
                  `Seu atendimento está previsto para *${horarioFormatado}*.\n\n` +
                  `Recomendamos que você se dirija para a barbearia.`;
      
      try {
        await enviarMensagem(numero, msg);
        return res.status(200).json({ 
          success: true,
          status: 'enviado',
          message: 'Aviso enviado imediatamente'
        });
      } catch (err) {
        return res.status(500).json({ 
          success: false,
          erro: 'Erro ao enviar mensagem: ' + err.message 
        });
      }
    }
    
    const minutosAteEnvio = Math.floor(diff / 60000);
    console.log(`⏰ Agendando aviso para ${minutosAteEnvio} minutos`);
    
    setTimeout(async () => {
      try {
        const horarioFormatado = formatarHorario(horario);
        const msg = `⏰ *Lembrete de Atendimento*\n\n` +
                    `Faltam apenas *15 minutos* para seu atendimento às *${horarioFormatado}*.\n\n` +
                    `Recomendamos que você comece a se dirigir para a barbearia.`;
        await enviarMensagem(numero, msg);
        console.log('✅ Mensagem agendada enviada com sucesso');
      } catch (err) {
        console.error('❌ Erro ao enviar mensagem agendada:', err);
      }
    }, diff);
    
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
      erro: error.message || 'Erro interno do servidor'
    });
  }
});

// Rota catch-all
app.use((req, res) => {
  res.status(404).json({ 
    success: false,
    erro: 'Rota não encontrada',
    method: req.method,
    path: req.originalUrl
  });
});

// ===== INICIALIZAÇÃO =====
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('\n🚀 ====================================');
  console.log('🤖 Chatbot da Barbearia Pedro');
  console.log('🚀 ====================================');
  console.log(`📡 API rodando na porta ${PORT}`);
  console.log(`🔗 Evolution API: ${EVOLUTION_API_URL}`);
  console.log(`📱 Instância: ${INSTANCE_NAME}`);
  console.log('📋 Endpoints disponíveis:');
  console.log('   POST /test');
  console.log('   POST /enviarFila');
  console.log('   POST /agendarAviso');
  console.log('🚀 ====================================\n');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});
