/* ============================================================
   app.js — Lógica da aplicação "Meus Simulados".
   Toda a parte de armazenamento (questões, respostas, histórico)
   vive em db.js (SQLite via sql.js). Este arquivo cuida de:
   geração de questões via IA, cronômetro, sessão, correção e
   o dashboard (caderno de desempenho por disciplina).
   ============================================================ */

const EDITAIS = {
  pcpr: {
    nome: "PC-PR", banca: "FGV", tipo: "multipla",
    disciplinas: ["Direito Penal", "Direito Processual Penal", "Direito Constitucional", "Direito Administrativo", "Legislação Penal Especial", "Língua Portuguesa", "Raciocínio Lógico", "Informática"],
    estilo: `Siga o padrão real da banca FGV: questões objetivas de múltipla escolha, com 5 alternativas (A a E) e apenas UMA correta. As alternativas devem ter extensão parecida entre si (evite deixar a alternativa correta sempre visivelmente mais longa ou mais completa que as demais). O enunciado pode trazer uma situação hipotética curta e objetiva, mas sem redação rebuscada. A dificuldade deve vir do conteúdo técnico (lei seca, súmulas, jurisprudência atual), e não de pegadinhas de interpretação de texto, duplo sentido ou ambiguidade proposital — a FGV cobra domínio da matéria, não "casca de banana" textual.`
  },
  prf: {
    nome: "PRF", banca: "Cebraspe", tipo: "certo_errado",
    disciplinas: ["Legislação de Trânsito (CTB)", "Direitos Humanos e Cidadania", "Ética no Serviço Público", "Língua Portuguesa", "Raciocínio Lógico Matemático", "Informática", "Física", "Direito Constitucional", "Direito Administrativo", "Direito Penal", "Direito Processual Penal", "Legislação Especial"],
    estilo: `Siga rigorosamente o padrão real da banca Cebraspe (CESPE): cada item é uma AFIRMAÇÃO ÚNICA e independente (nunca múltipla escolha), a ser julgada isoladamente como CERTA (C) ou ERRADA (E). Use frases bem estruturadas, frequentemente combinando duas ideias jurídicas conectadas por termos como "considerando que...", "nessa situação...", "é correto afirmar que...". Baseie-se estritamente na letra da lei, em súmulas do STF/STJ e jurisprudência consolidada — o erro típico Cebraspe costuma estar em um detalhe técnico específico (prazo, competência, exceção legal), não em pegadinha de português. Cada item precisa ter uma resposta objetivamente certa ou errada, sem ambiguidade. NUNCA gere alternativas A-E: sempre apenas C ou E.`
  },
  enem: {
    nome: "ENEM", banca: "INEP", tipo: "multipla", alternativas: 5,
    disciplinas: ["Língua Portuguesa", "Literatura", "Artes e Educação Física", "Inglês", "Espanhol", "História", "Geografia", "Filosofia", "Sociologia", "Física", "Química", "Biologia", "Matemática"],
    areas: {
      "Linguagens, Códigos e suas Tecnologias": ["Língua Portuguesa", "Literatura", "Artes e Educação Física", "Inglês", "Espanhol"],
      "Ciências Humanas e suas Tecnologias": ["História", "Geografia", "Filosofia", "Sociologia"],
      "Ciências da Natureza e suas Tecnologias": ["Física", "Química", "Biologia"],
      "Matemática e suas Tecnologias": ["Matemática"]
    },
    estilo: `Siga o padrão real do ENEM (INEP): questão objetiva de múltipla escolha com 5 alternativas (A a E) e apenas UMA correta, sempre CONTEXTUALIZADA. O enunciado começa com um texto-base (trecho literário ou jornalístico, dados de pesquisa, situação do cotidiano, descrição de gráfico, tabela, charge, mapa ou figura) e termina com um comando claro. Como não há imagens, quando a questão depender de gráfico, tabela, mapa ou figura, DESCREVA-O em texto (tabelas em texto simples, com linhas e colunas) usando dados numéricos coerentes. Avalie competências e habilidades da Matriz de Referência do ENEM (interpretar, analisar, resolver situações-problema, argumentar, propor intervenção), com interdisciplinaridade e sem cobrar memorização isolada. Distratores plausíveis e de extensão parecida. Em Matemática e Ciências da Natureza use situações reais (proporcionalidade, estatística, geometria, energia, ambiente, saúde) e escreva fórmulas em texto simples (ex.: x^2, raiz quadrada de 5, 3/4, m/s^2), sem LaTeX e sem HTML. Não invente citações nem atribua falas a pessoas reais: elabore textos-base originais ou use apenas fatos e obras que você conhece com certeza.`
  }
};

// Distribuição aproximada de questões por disciplina em um bloco de 45 questões (uma área do ENEM)
const ENEM_DISTRIBUICAO = {
  "Língua Portuguesa": 20, "Literatura": 10, "Artes e Educação Física": 10, "Inglês": 5, "Espanhol": 5,
  "História": 15, "Geografia": 15, "Filosofia": 8, "Sociologia": 7,
  "Física": 15, "Química": 15, "Biologia": 15, "Matemática": 45
};
let planoEnem = null; // { total, lista } — define a disciplina de cada questão quando um preset ENEM é usado

// ---------- Concursos personalizados (qualquer carreira, cargo, banca ou concurso) ----------
const EDITAIS_BASE_KEYS = Object.keys(EDITAIS);

function carregarConcursosCustom() {
  try {
    const lista = JSON.parse(LS.getItem('concursos_custom') || '[]');
    lista.forEach(c => { if (c && c.key && !EDITAIS[c.key]) EDITAIS[c.key] = c.def; });
  } catch (e) { console.error('[Concursos] erro ao carregar personalizados:', e); }
}
function salvarListaConcursosCustom() {
  const lista = Object.keys(EDITAIS).filter(k => !EDITAIS_BASE_KEYS.includes(k)).map(k => ({ key: k, def: EDITAIS[k] }));
  LS.setItem('concursos_custom', JSON.stringify(lista));
}

function renderExamTabs() {
  const box = document.getElementById('examTabs');
  if (!box) return;
  box.innerHTML = Object.keys(EDITAIS).map(k =>
    `<div class="tab ${k === currentExam ? 'active' : ''}" data-exam="${k}" onclick="setExam('${k}')">${escapeHtml(EDITAIS[k].nome)} (${escapeHtml(EDITAIS[k].banca)})</div>`
  ).join('');
  const painelEnem = document.getElementById('enemPanel');
  if (painelEnem) painelEnem.classList.toggle('hidden', currentExam !== 'enem');
  const btnExc = document.getElementById('btnExcluirConcurso');
  if (btnExc) btnExc.classList.toggle('hidden', EDITAIS_BASE_KEYS.includes(currentExam));
}

function abrirFormConcurso() { document.getElementById('formConcurso').classList.remove('hidden'); document.getElementById('ncNome').focus(); }
function fecharFormConcurso() {
  document.getElementById('formConcurso').classList.add('hidden');
  ['ncNome', 'ncBanca', 'ncDisc', 'ncEstilo'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('ncMsg').textContent = '';
}

function salvarConcursoCustom() {
  const nome = document.getElementById('ncNome').value.trim();
  const banca = document.getElementById('ncBanca').value.trim();
  const tipo = document.getElementById('ncTipo').value;
  const alternativas = parseInt(document.getElementById('ncAlt').value, 10) || 5;
  const disciplinas = document.getElementById('ncDisc').value.split(',').map(d => d.trim()).filter(Boolean);
  const msg = document.getElementById('ncMsg');
  if (!nome || !banca) { msg.textContent = 'Informe o nome do concurso e a banca.'; return; }
  if (!disciplinas.length) { msg.textContent = 'Informe ao menos uma disciplina (separadas por vírgula).'; return; }

  let estilo = document.getElementById('ncEstilo').value.trim();
  if (!estilo) {
    estilo = tipo === 'certo_errado'
      ? `Siga o padrão da banca ${banca}: cada item é uma AFIRMAÇÃO ÚNICA e independente, a ser julgada como CERTA (C) ou ERRADA (E). Baseie-se na letra da lei, súmulas e jurisprudência consolidada, com resposta objetivamente certa ou errada e sem ambiguidade. NUNCA gere alternativas A-E: sempre apenas C ou E.`
      : `Siga o padrão real da banca ${banca}: questões objetivas de múltipla escolha com ${alternativas} alternativas (${'ABCDE'.slice(0, alternativas).split('').join(', ')}) e apenas UMA correta. Alternativas de extensão parecida, enunciados claros e dificuldade vinda do conteúdo técnico, sem ambiguidade proposital.`;
  }
  const key = 'c_' + slugify(nome + '-' + banca) + '_' + Date.now().toString(36);
  EDITAIS[key] = { nome, banca, tipo, alternativas, disciplinas, estilo, custom: true };
  salvarListaConcursosCustom();
  fecharFormConcurso();
  setExam(key);
}

function excluirConcursoAtual() {
  if (EDITAIS_BASE_KEYS.includes(currentExam)) return;
  const e = EDITAIS[currentExam];
  if (!confirm(`Excluir o concurso "${e.nome} (${e.banca})"?\n\nAs questões e o histórico dele continuam salvos no banco, mas ele deixa de aparecer nas abas.`)) return;
  delete EDITAIS[currentExam];
  salvarListaConcursosCustom();
  setExam(EDITAIS_BASE_KEYS[0]);
}

// ---------- Módulo ENEM ----------
function limparPlanoEnem() {
  planoEnem = null;
  const m = document.getElementById('enemPresetMsg');
  if (m) m.textContent = '';
}
function embaralhar(arr) {
  const r = arr.slice();
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}
function slotsDaArea(area, lingua) {
  const discs = EDITAIS.enem.areas[area].filter(d => !(['Inglês', 'Espanhol'].includes(d) && d !== lingua));
  let lista = [];
  discs.forEach(d => { for (let i = 0; i < (ENEM_DISTRIBUICAO[d] || 0); i++) lista.push(d); });
  return embaralhar(lista);
}
// Monta quantidade, tempo, disciplinas e a distribuição exata de questões do formato oficial
function aplicarPresetEnem(tipo) {
  const areas = Object.keys(EDITAIS.enem.areas);
  const lingua = document.getElementById('enemLingua').value;
  const mapa = { dia1: [areas[0], areas[1]], dia2: [areas[2], areas[3]], linguagens: [areas[0]], humanas: [areas[1]], natureza: [areas[2]], matematica: [areas[3]] };
  const eDia1 = ['dia1', 'linguagens', 'humanas'].includes(tipo);
  let lista = [];
  mapa[tipo].forEach(a => { lista = lista.concat(slotsDaArea(a, lingua)); });
  const minutos = Math.round(lista.length * (eDia1 ? 330 : 300) / 90); // Dia 1: 5h30 · Dia 2: 5h para 90 questões
  document.getElementById('qCount').value = lista.length;
  document.getElementById('tempoSimulado').value = minutos;
  selectedDisc = new Set(lista);
  renderChips();
  planoEnem = { total: lista.length, lista };
  const h = Math.floor(minutos / 60), m = minutos % 60;
  document.getElementById('enemPresetMsg').textContent = `Preset aplicado: ${lista.length} questões · ${h}h${String(m).padStart(2, '0')} · distribuição por disciplina já definida. Clique em "Gerar Inéditas" para montar.`;
}

// Acertos por área do ENEM (a nota oficial usa TRI e não é reproduzível aqui)
function resumoPorArea(exameKey, lista, respostas) {
  const areas = EDITAIS[exameKey].areas;
  if (!areas) return null;
  const out = Object.keys(areas).map(nome => ({ nome, acertos: 0, erros: 0, brancos: 0, total: 0 }));
  lista.forEach((q, idx) => {
    const a = out.find(o => areas[o.nome].includes(q.disciplina));
    if (!a) return;
    a.total++;
    const r = respostas[idx];
    if (r === undefined) a.brancos++; else if (r === q.gab) a.acertos++; else a.erros++;
  });
  return out.filter(a => a.total > 0);
}

function lerQuantidade() {
  const n = parseInt(document.getElementById('qCount').value, 10);
  if (!n || n < 1) return 20;
  return Math.min(200, n);
}

let currentExam = 'pcpr';
let selectedDisc = new Set(EDITAIS.pcpr.disciplinas);
let quizAtual = [];
let respostasUsuario = {};
let timerInterval = null;
let tempoRestante = 0;
let tempoInicial = 0;
let isTimerPaused = false;
let gerandoEmSegundoPlano = false;
let provaIniciada = false;
let cancelarGeracao = false;
let finalizarAoEncerrar = false;
let quizExameKey = null;
let quizModoGabarito = 'final'; // 'final' | 'imediato'

// ---------- Boot ----------
document.addEventListener("DOMContentLoaded", () => { Auth.iniciar(iniciarApp); });

// Dados salvos neste navegador ANTES de existir login ficam num banco "antigo". Na primeira entrada
// de uma conta, oferecemos associá-los a ela (sem apagar nada do navegador).
const CHAVES_LEGADO = /^(ai_provider|api_key_|api_model_|modelos_reserva_|ordem_provedores|provedores_ativos|stats_provedores|fallback_|log_modelos|sessao_ativa|concursos_custom)/;

async function oferecerMigracaoLegado(uid) {
  if (localStorage.getItem('legacy_claimed_by')) return;                 // outra conta já herdou os dados antigos
  if (localStorage.getItem(`legacy_declined_${uid}`)) return;            // esta conta já recusou
  const chaves = [];
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (CHAVES_LEGADO.test(k)) chaves.push(k); }
  const bytes = await DB.lerBancoLegado();
  if (!bytes && !chaves.length) return;                                  // nada para migrar
  const quer = confirm('Encontramos dados salvos neste navegador de antes do login (banco de questões, histórico e configurações de IA).\n\nDeseja associá-los a esta conta?\n\nOK = associar a esta conta\nCancelar = começar vazio (os dados antigos continuam guardados no navegador)');
  if (!quer) { localStorage.setItem(`legacy_declined_${uid}`, '1'); return; }
  if (bytes) await DB.gravarBancoDoUsuario(uid, bytes);
  chaves.forEach(k => localStorage.setItem(`u_${uid}_${k}`, localStorage.getItem(k)));
  localStorage.setItem('legacy_claimed_by', uid);
}

async function iniciarApp(usuario) {
  const uid = (usuario && usuario.uid) || null;
  const loadingEl = document.getElementById('dbLoading');
  try {
    if (uid) await oferecerMigracaoLegado(uid);
    await DB.init(uid);
    if (uid) await Nuvem.oferecerRestauracaoInicial(); // banco vazio + backup na nuvem → oferece restaurar
  } catch (e) {
    console.error('[App] falha ao iniciar o banco de dados:', e);
    if (loadingEl) loadingEl.textContent = '❌ Falha ao carregar o banco de dados local. Veja o console (F12).';
    return;
  }
  if (loadingEl) loadingEl.classList.add('hidden');
  document.getElementById('appRoot').classList.remove('hidden');

  const prov = LS.getItem('ai_provider') || 'gemini';
  document.getElementById('apiProvider').value = prov;
  changeProvider();
  const mod = LS.getItem(`api_model_${prov}`);
  if (mod) document.getElementById('apiModel').innerHTML = `<option value="${mod}">${mod}</option>`;

  document.getElementById('fallbackAtivo').checked = LS.getItem('fallback_ativo') !== '0'; // padrão: ligado
  document.getElementById('fallbackAutoRank').checked = LS.getItem('fallback_auto_rank') === '1';
  document.getElementById('fallbackUsarLog').checked = LS.getItem('fallback_usar_log') !== '0'; // padrão: ligado
  renderListaProvedoresFallback();
  renderLogModelos();

  carregarConcursosCustom();
  renderExamTabs();
  renderChips();
  updateDashboard();
  verificarSessaoSalva();
  Nuvem.atualizarUI();
  atualizarGateChaveIA();
  if (gateChaveIAAtivo()) switchView('config');
  if (window.innerWidth < 820) document.querySelector('.sidebar').classList.add('collapsed');

  const cadernosBox = document.getElementById('dashCadernos');
  if (cadernosBox) {
    cadernosBox.addEventListener('click', (e) => {
      const alvo = e.target.closest('[data-acao]');
      if (!alvo) return;
      const acao = alvo.dataset.acao;
      const exame = alvo.dataset.exame;
      if (acao === 'toggle-caderno') toggleBloco('caderno-' + exame);
      else if (acao === 'toggle-disciplina') toggleDisciplina(exame, alvo.dataset.slug);
      else if (acao === 'filtro-disc') setFiltroDisciplina(exame, alvo.dataset.slug, alvo.dataset.filtro);
      else if (acao === 'refazer-disc-erradas') refazerDisciplina(exame, alvo.dataset.disc, true);
      else if (acao === 'refazer-disc-todas') refazerDisciplina(exame, alvo.dataset.disc, false);
      else if (acao === 'refazer-questao') refazerQuestao(exame, parseInt(alvo.dataset.id, 10));
    });
  }
}

window.addEventListener('beforeunload', (e) => {
  if (provaIniciada && quizAtual.length) {
    salvarSessao();
    e.preventDefault();
    e.returnValue = '';
  }
});

function toggleMenu() { document.querySelector('.sidebar').classList.toggle('collapsed'); }
function limparPDF() { document.getElementById('pdfUpload').value = ''; }

function atualizarAvisoPdfMode() {
  const el = document.getElementById('pdfModeAviso');
  if (!el) return;
  const modo = document.getElementById('pdfMode').value;
  el.textContent = modo === 'transcricao'
    ? '⚠️ Nesse modo a IA copia as questões literalmente do PDF (sem inventar nada novo) e só calcula o gabarito/explicação quando o PDF não traz. A quantidade final depende de quantas questões existirem no PDF, e o formato (múltipla escolha ou Certo/Errado) deve bater com a prova selecionada acima (FGV ou Cebraspe).'
    : '';
}

// ---------- Configuração de IA (continua em localStorage: são só preferências, não "banco de dados") ----------
function changeProvider() {
  const prov = document.getElementById('apiProvider').value;
  document.getElementById('apiKey').value = LS.getItem(`api_key_${prov}`) || '';
  document.getElementById('apiModel').innerHTML = '<option value="">Clique em Buscar Modelos...</option>';
  document.getElementById('configMsg').textContent = "";
  renderModelosReserva();
}

async function buscarModelos() {
  const prov = document.getElementById('apiProvider').value;
  const apiKey = document.getElementById('apiKey').value.trim();
  const msgDiv = document.getElementById('configMsg');
  const select = document.getElementById('apiModel');
  if (!apiKey) { msgDiv.style.color = 'var(--danger)'; msgDiv.textContent = "Cole sua chave de API primeiro!"; return; }

  msgDiv.style.color = 'var(--primary)';
  msgDiv.textContent = "Buscando modelos...";
  select.innerHTML = '<option value="">Carregando...</option>';

  try {
    let optionsHTML = ""; let data = null;
    if (prov === 'gemini') {
      const res = await fetchComTimeout(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {}, 15000);
      data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const validos = data.models.filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"));
      if (validos.length === 0) throw new Error("Sem modelos disponíveis.");
      validos.forEach(m => { const id = m.name.replace('models/', ''); optionsHTML += `<option value="${id}">${m.displayName} (${id})</option>`; });
    } else if (prov === 'cohere') {
      const res = await fetchComTimeout('https://api.cohere.com/v1/models?endpoint=chat', { headers: { 'Authorization': `Bearer ${apiKey}` } }, 15000);
      data = await lerRespostaJson(res);
      const lista = data.models || [];
      if (!lista.length) throw new Error("Sem modelos disponíveis.");
      lista.forEach(m => { optionsHTML += `<option value="${m.name}">${m.name}</option>`; });
    } else if (ENDPOINTS_OPENAI_COMPAT[prov]) {
      const res = await fetchComTimeout(ENDPOINTS_OPENAI_COMPAT[prov].models, { headers: { 'Authorization': `Bearer ${apiKey}` } }, 15000);
      data = await lerRespostaJson(res);
      let modelos = data.data || [];
      if (prov === 'openrouter') {
        modelos.sort((a, b) => a.id.includes('free') ? -1 : 1);
        modelos.forEach(m => { const isFree = m.id.includes(':free') ? ' 🎁 (Gratuito)' : ''; optionsHTML += `<option value="${m.id}">${m.id}${isFree}</option>`; });
      } else {
        modelos.forEach(m => { optionsHTML += `<option value="${m.id}">${m.id}</option>`; });
      }
    }
    select.innerHTML = optionsHTML;
    msgDiv.style.color = 'var(--success)';
    msgDiv.textContent = "Modelos listados!";
  } catch (err) {
    msgDiv.style.color = 'var(--danger)';
    msgDiv.textContent = "Erro: " + err.message;
    select.innerHTML = '<option value="">Falha ao carregar.</option>';
  }
}

function saveConfig() {
  const estavaBloqueado = gateChaveIAAtivo();
  const prov = document.getElementById('apiProvider').value;
  const key = document.getElementById('apiKey').value.trim();
  const mod = document.getElementById('apiModel').value;
  if (!key || !mod) { document.getElementById('configMsg').style.color = 'var(--danger)'; document.getElementById('configMsg').textContent = "Busque os modelos e selecione um antes de salvar."; return; }
  LS.setItem('ai_provider', prov);
  LS.setItem(`api_key_${prov}`, key);
  LS.setItem(`api_model_${prov}`, mod);
  const msg = document.getElementById('configMsg'); msg.style.color = 'var(--success)'; msg.textContent = `Salvo! (${mod})`;
  setTimeout(() => msg.textContent = "", 3000);
  renderListaProvedoresFallback();
  renderModelosReserva();
  atualizarGateChaveIA();
  if (estavaBloqueado && !gateChaveIAAtivo()) {
    msg.textContent = `Salvo! (${mod}) Tudo liberado — abrindo a tela de simulados...`;
    setTimeout(() => switchView('gerar'), 1200);
  }
}

// ---------- Fallback automático entre provedores (load balancing) ----------
const PROVEDORES_INFO = {
  gemini: 'Google Gemini', groq: 'Groq', openrouter: 'OpenRouter', openai: 'OpenAI',
  mistral: 'Mistral', deepseek: 'DeepSeek', cohere: 'Cohere'
};
const ORDEM_PADRAO = ['gemini', 'groq', 'openrouter', 'openai', 'mistral', 'deepseek', 'cohere'];

function getOrdemProvedores() {
  try {
    const o = JSON.parse(LS.getItem('ordem_provedores'));
    if (!Array.isArray(o) || !o.length) return ORDEM_PADRAO.slice();
    const base = o.filter(p => PROVEDORES_INFO[p]);
    ORDEM_PADRAO.forEach(p => { if (!base.includes(p)) base.push(p); }); // acrescenta provedores novos ao fim
    return base;
  } catch (e) { return ORDEM_PADRAO.slice(); }
}
function setOrdemProvedores(lista) { LS.setItem('ordem_provedores', JSON.stringify(lista)); }

function getProvedoresAtivos() {
  try { return JSON.parse(LS.getItem('provedores_ativos')) || {}; }
  catch (e) { return {}; }
}
function setProvedorAtivo(prov, ativo) {
  const a = getProvedoresAtivos(); a[prov] = ativo; LS.setItem('provedores_ativos', JSON.stringify(a));
}

function getStatsProvedores() {
  try { return JSON.parse(LS.getItem('stats_provedores')) || {}; } catch (e) { return {}; }
}
function bumpStatsProvedor(prov, sucesso) {
  const s = getStatsProvedores();
  if (!s[prov]) s[prov] = { sucessos: 0, falhas: 0, ultimaFalha: null };
  if (sucesso) s[prov].sucessos++; else { s[prov].falhas++; s[prov].ultimaFalha = Date.now(); }
  LS.setItem('stats_provedores', JSON.stringify(s));
}
function resetarStatsProvedores() {
  if (!confirm('Zerar o histórico de sucesso/falha de todos os provedores?')) return;
  LS.removeItem('stats_provedores');
  renderListaProvedoresFallback();
}

function providerConfigurado(prov) {
  return !!(LS.getItem(`api_key_${prov}`) && LS.getItem(`api_model_${prov}`));
}

function salvarConfigFallback() {
  LS.setItem('fallback_ativo', document.getElementById('fallbackAtivo').checked ? '1' : '0');
  LS.setItem('fallback_auto_rank', document.getElementById('fallbackAutoRank').checked ? '1' : '0');
  const chkLog = document.getElementById('fallbackUsarLog');
  if (chkLog) LS.setItem('fallback_usar_log', chkLog.checked ? '1' : '0');
}

function moverProvedor(prov, direcao) {
  const ordem = getOrdemProvedores();
  const i = ordem.indexOf(prov);
  const j = i + direcao;
  if (i < 0 || j < 0 || j >= ordem.length) return;
  [ordem[i], ordem[j]] = [ordem[j], ordem[i]];
  setOrdemProvedores(ordem);
  renderListaProvedoresFallback();
}
function alternarProvedorAtivo(prov) {
  const ativos = getProvedoresAtivos();
  setProvedorAtivo(prov, !ativos[prov]);
  renderListaProvedoresFallback();
}

// Monta a ordem final de tentativa: respeita a ordem manual, mas se "reordenar por
// confiabilidade" estiver ligado, prioriza quem tem maior taxa de sucesso recente.
function listaProvedoresParaFallback() {
  const ordem = getOrdemProvedores();
  const ativos = getProvedoresAtivos();
  const autoRank = LS.getItem('fallback_auto_rank') === '1';
  let candidatos = ordem.filter(p => providerConfigurado(p) && ativos[p] !== false);
  if (autoRank) {
    const stats = getStatsProvedores();
    candidatos = candidatos.slice().sort((a, b) => {
      const sa = stats[a] || { sucessos: 0, falhas: 0 }, sb = stats[b] || { sucessos: 0, falhas: 0 };
      const totalA = sa.sucessos + sa.falhas, totalB = sb.sucessos + sb.falhas;
      const taxaA = totalA ? sa.sucessos / totalA : 0.5; // sem histórico = neutro
      const taxaB = totalB ? sb.sucessos / totalB : 0.5;
      return taxaB - taxaA;
    });
  }
  return candidatos;
}

function renderListaProvedoresFallback() {
  const box = document.getElementById('listaProvedoresFallback');
  if (!box) return;
  const ordem = getOrdemProvedores();
  const ativos = getProvedoresAtivos();
  const stats = getStatsProvedores();
  box.innerHTML = ordem.map((prov, i) => {
    const configurado = providerConfigurado(prov);
    const ativo = ativos[prov] !== false;
    const s = stats[prov] || { sucessos: 0, falhas: 0 };
    const total = s.sucessos + s.falhas;
    const taxa = total ? Math.round((s.sucessos / total) * 100) : null;
    return `<div class="qhist-row" style="flex-wrap:nowrap;">
        <span style="width:22px; color:var(--text-light); font-size:.8rem;">#${i + 1}</span>
        <span style="flex:1; min-width:120px;">${PROVEDORES_INFO[prov]}</span>
        <span class="qhist-disc" style="${configurado ? '' : 'color:var(--danger);'}">${configurado ? 'configurado · ' + modelosDoProvedor(prov).length + ' modelo(s)' : 'sem chave/modelo'}</span>
        <span class="small" style="color:var(--text-light); min-width:90px;">${total ? `${taxa}% êxito (${total})` : 'sem histórico'}</span>
        <label style="display:flex; align-items:center; gap:4px; font-size:.78rem; cursor:pointer;">
            <input type="checkbox" ${ativo ? 'checked' : ''} onchange="alternarProvedorAtivo('${prov}')" style="width:auto; margin:0;"> ativo
        </label>
        <button class="btn btn-outline btn-small" onclick="moverProvedor('${prov}', -1)" ${i === 0 ? 'disabled' : ''} title="Subir prioridade">▲</button>
        <button class="btn btn-outline btn-small" onclick="moverProvedor('${prov}', 1)" ${i === ordem.length - 1 ? 'disabled' : ''} title="Descer prioridade">▼</button>
    </div>`;
  }).join('');
}

// ---------- Log de modelos de IA ----------
const COOLDOWN_MS = 10 * 60 * 1000; // modelo que esgotou a cota fica de lado por 10 minutos

function getLogModelos() { try { return JSON.parse(LS.getItem('log_modelos')) || []; } catch (e) { return []; } }
function registrarLogModelo(prov, modelo, resultado, detalhe) {
  const log = getLogModelos();
  log.unshift({ prov, modelo, resultado, quando: Date.now(), detalhe: String(detalhe || '').slice(0, 140) });
  LS.setItem('log_modelos', JSON.stringify(log.slice(0, 60)));
  renderLogModelos();
}
function limparLogModelos() {
  if (!confirm('Apagar o log de modelos de IA?')) return;
  LS.removeItem('log_modelos');
  renderLogModelos();
}
function classificarFalha(e) {
  const msg = String((e && e.message) || '');
  if ((e && e.status === 429) || /quota|rate.?limit|exhaust|too many|resource.?exhausted/i.test(msg)) return 'esgotado';
  return 'erro';
}
function modeloEmCooldown(prov, modelo) {
  if (LS.getItem('fallback_usar_log') === '0') return false;
  const ultimo = getLogModelos().find(l => l.prov === prov && l.modelo === modelo);
  return !!(ultimo && ultimo.resultado === 'esgotado' && (Date.now() - ultimo.quando) < COOLDOWN_MS);
}
function renderLogModelos() {
  const tabela = document.getElementById('logModelosTabela');
  const resumo = document.getElementById('logModelosResumo');
  if (!tabela) return;
  const log = getLogModelos();
  // estado atual = último registro de cada par fonte+modelo
  const ultimoPorPar = {};
  log.slice().reverse().forEach(l => { ultimoPorPar[l.prov + '::' + l.modelo] = l; });
  const estados = Object.values(ultimoPorPar);
  const nOk = estados.filter(l => l.resultado === 'ok').length;
  const nEsg = estados.filter(l => l.resultado === 'esgotado').length;
  const nErr = estados.filter(l => l.resultado === 'erro').length;
  resumo.textContent = log.length ? `${nOk} modelo(s) funcionando · ${nEsg} esgotado(s) · ${nErr} com erro` : 'Nenhum teste registrado ainda. O log é preenchido automaticamente a cada geração.';
  if (!log.length) { tabela.innerHTML = ''; return; }
  const rotulo = { ok: '✅ funcionou', esgotado: '⏸ esgotado', erro: '❌ erro' };
  tabela.innerHTML = `<table class="log-table"><thead><tr><th>Fonte</th><th>Modelo</th><th>Resultado</th><th>Quando</th><th>Detalhe</th></tr></thead><tbody>${
    log.slice(0, 15).map(l => `<tr>
      <td>${escapeHtml(PROVEDORES_INFO[l.prov] || l.prov)}</td><td>${escapeHtml(l.modelo)}</td>
      <td>${rotulo[l.resultado] || escapeHtml(l.resultado)}</td><td>${new Date(l.quando).toLocaleString('pt-BR')}</td>
      <td>${escapeHtml(l.detalhe)}</td></tr>`).join('')
  }</tbody></table>`;
}

// ---------- Modelos reserva (vários modelos por provedor) ----------
function getModelosReserva(prov) {
  try { const l = JSON.parse(LS.getItem(`modelos_reserva_${prov}`)); return Array.isArray(l) ? l : []; } catch (e) { return []; }
}
function setModelosReserva(prov, lista) { LS.setItem(`modelos_reserva_${prov}`, JSON.stringify(lista)); }
// Principal primeiro, depois os reservas (sem repetir)
function modelosDoProvedor(prov) {
  const principal = LS.getItem(`api_model_${prov}`);
  return [principal].concat(getModelosReserva(prov)).filter((m, i, a) => m && a.indexOf(m) === i);
}

function adicionarModeloReserva() {
  const prov = document.getElementById('apiProvider').value;
  const modelo = document.getElementById('apiModel').value;
  const msg = document.getElementById('configMsg');
  if (!modelo) { msg.style.color = 'var(--danger)'; msg.textContent = 'Clique em "Buscar Modelos" e selecione um modelo antes de adicioná-lo como reserva.'; return; }
  if (modelosDoProvedor(prov).includes(modelo)) { msg.style.color = 'var(--danger)'; msg.textContent = 'Esse modelo já está na lista deste provedor.'; return; }
  if (!LS.getItem(`api_model_${prov}`)) { msg.style.color = 'var(--danger)'; msg.textContent = 'Salve primeiro o modelo principal (botão "Salvar Configurações").'; return; }
  setModelosReserva(prov, getModelosReserva(prov).concat(modelo));
  msg.style.color = 'var(--success)'; msg.textContent = `Modelo reserva adicionado: ${modelo}`;
  setTimeout(() => msg.textContent = '', 3000);
  renderModelosReserva(); renderListaProvedoresFallback();
}
function removerModeloReserva(prov, modelo) {
  setModelosReserva(prov, getModelosReserva(prov).filter(m => m !== modelo));
  renderModelosReserva(); renderListaProvedoresFallback();
}
function renderModelosReserva() {
  const box = document.getElementById('listaModelosReserva');
  const sel = document.getElementById('apiProvider');
  if (!box || !sel) return;
  const prov = sel.value;
  const principal = LS.getItem(`api_model_${prov}`);
  const reservas = getModelosReserva(prov);
  if (!principal && !reservas.length) { box.innerHTML = '<p class="small" style="color:var(--text-light);">Nenhum modelo salvo para este provedor ainda.</p>'; return; }
  box.innerHTML = [principal ? `<div class="qhist-row"><span class="qhist-disc">principal</span><span class="qhist-text">${escapeHtml(principal)}</span></div>` : '']
    .concat(reservas.map((m, i) => `<div class="qhist-row"><span class="qhist-disc">reserva ${i + 1}</span><span class="qhist-text">${escapeHtml(m)}</span>
      <button class="btn btn-outline btn-small" onclick="removerModeloReserva('${prov}', this.dataset.m)" data-m="${escapeHtml(m)}">Remover</button></div>`)).join('');
}

// Núcleo do rodízio: monta a fila de pares (provedor, modelo) e executa a tarefa no primeiro que funcionar.
// Ordem: provedores na prioridade escolhida; dentro de cada um, modelo principal e depois os reservas.
// Modelos que esgotaram a cota há menos de 10 min (se "usar o log" estiver ligado) vão para o fim da fila.
async function executarComFallback(tarefa, aoTentar) {
  const candidatos = listaProvedoresParaFallback();
  if (!candidatos.length) throw new Error('Nenhum provedor de IA configurado e ativo. Configure pelo menos um em "Configurar API".');
  const pares = [];
  candidatos.forEach(prov => modelosDoProvedor(prov).forEach(modelo => pares.push({ prov, modelo })));
  const fila = pares.filter(x => !modeloEmCooldown(x.prov, x.modelo)).concat(pares.filter(x => modeloEmCooldown(x.prov, x.modelo)));
  const chaveInvalida = new Set(); // 401/403: a chave é do provedor, então não adianta tentar os outros modelos dele
  let ultimoErro = null;
  for (const { prov, modelo } of fila) {
    if (chaveInvalida.has(prov)) continue;
    const apiKey = LS.getItem(`api_key_${prov}`);
    if (aoTentar) aoTentar(prov, modelo);
    try {
      const resultado = await tarefa(prov, apiKey, modelo);
      bumpStatsProvedor(prov, true);
      registrarLogModelo(prov, modelo, 'ok', 'resposta recebida');
      return { resultado, provedorUsado: prov, modeloUsado: modelo };
    } catch (e) {
      bumpStatsProvedor(prov, false);
      registrarLogModelo(prov, modelo, classificarFalha(e), e.message);
      if (e && (e.status === 401 || e.status === 403)) chaveInvalida.add(prov);
      ultimoErro = e;
      console.warn(`[Fallback] ${PROVEDORES_INFO[prov]} / ${modelo} falhou (${e.message}) — tentando o próximo...`);
    }
  }
  throw ultimoErro || new Error('Todos os provedores configurados falharam.');
}

// Roda uma tarefa de IA respeitando o modo escolhido (fallback automático ou provedor único).
async function rodarComIA(tarefa, aoTentar) {
  if (LS.getItem('fallback_ativo') !== '0') return executarComFallback(tarefa, aoTentar);
  const prov = LS.getItem('ai_provider') || 'gemini';
  const apiKey = LS.getItem(`api_key_${prov}`), apiModel = LS.getItem(`api_model_${prov}`);
  if (!apiKey || !apiModel) throw new Error('Configure e salve um modelo da API em "Configurar API".');
  const resultado = await tarefa(prov, apiKey, apiModel);
  return { resultado, provedorUsado: prov, modeloUsado: apiModel };
}

async function gerarQuestoesComFallback(count, diff, materias, examKey, extraContext, enunciadosVistos, modoTranscricao, slots, aoTentar) {
  const r = await executarComFallback(
    (prov, key, modelo) => gerarQuestoes(prov, key, modelo, count, diff, materias, examKey, extraContext, enunciadosVistos, modoTranscricao, slots),
    aoTentar);
  return { questoes: r.resultado, provedorUsado: r.provedorUsado, modeloUsado: r.modeloUsado };
}

// ---------- Navegação ----------
// ---------- Trava: sem ao menos um provedor de IA configurado, só a tela de configuração fica liberada ----------
function nenhumProvedorConfigurado() { return !ORDEM_PADRAO.some(p => providerConfigurado(p)); }
function gateChaveIAAtivo() {
  return !!(typeof Auth !== 'undefined' && Auth.usuario && Auth.opcoes().exigirChaveIA && nenhumProvedorConfigurado());
}
function atualizarGateChaveIA() {
  const ativo = gateChaveIAAtivo();
  const banner = document.getElementById('gateChaveIA');
  if (banner) banner.classList.toggle('hidden', !ativo);
  document.querySelectorAll('.nav-item').forEach(el => {
    const m = /switchView\('([a-z]+)'\)/.exec(el.getAttribute('onclick') || '');
    el.classList.toggle('nav-disabled', ativo && !!m && m[1] !== 'config');
  });
}

function switchView(viewId) {
  if (gateChaveIAAtivo() && viewId !== 'config') {
    alert('Antes de continuar, configure ao menos um provedor de IA (chave + modelo) em "Configurar API".');
    viewId = 'config';
  }
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const nav = document.querySelector(`.nav-item[onclick*="'${viewId}'"]`);
  if (nav) nav.classList.add('active');
  ['view-dashboard', 'view-config', 'view-gerar', 'view-quiz', 'view-redacao'].forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById('view-' + viewId).classList.remove('hidden');
  if (viewId === 'dashboard') updateDashboard();
  if (viewId === 'redacao') renderHistoricoRedacoes();
}
function switchViewPorId(viewId) { switchView(viewId); }

function setExam(examKey) {
  limparPlanoEnem();
  currentExam = examKey;
  selectedDisc = new Set(EDITAIS[examKey].disciplinas);
  renderExamTabs();
  renderChips();
}

function renderChips() {
  const grid = document.getElementById('discGrid');
  grid.innerHTML = EDITAIS[currentExam].disciplinas.map(d => `<div class="chip ${selectedDisc.has(d) ? 'active' : ''}" data-val="${d}" onclick="toggleChip(this)">${d}</div>`).join('');
}
function toggleChip(el) {
  limparPlanoEnem();
  const val = el.getAttribute('data-val');
  if (selectedDisc.has(val)) { selectedDisc.delete(val); el.classList.remove('active'); }
  else { selectedDisc.add(val); el.classList.add('active'); }
}

// ---------- Priorização de questões do banco local (pondera por taxa de erro) ----------
function selecionarComPrioridade(exameKey, banco, n) {
  const pesosQ = DB.getPesosQuestoes(exameKey);
  const pesadas = banco.map(q => {
    const st = pesosQ[q.id];
    let peso = 1.5; // nunca vista: prioridade média-alta, pra cobrir o banco todo
    if (st && st.vezes > 0) {
      const taxaErro = st.erros / st.vezes;
      peso = 1 + taxaErro * 3;
      if (st.vezes >= 3 && taxaErro === 0) peso = 0.3; // já domina bem, aparece bem menos
    }
    return { q, peso };
  });
  const pool = pesadas.slice();
  const resultado = [];
  while (resultado.length < n && pool.length) {
    const totalPeso = pool.reduce((s, p) => s + p.peso, 0);
    let r = Math.random() * totalPeso, idx = 0;
    for (; idx < pool.length - 1; idx++) { r -= pool[idx].peso; if (r <= 0) break; }
    resultado.push(pool[idx].q);
    pool.splice(idx, 1);
  }
  return resultado;
}

function limparBanco() {
  if (confirm("Apagar TODO o banco de dados local (questões, histórico de respostas e de simulados)? Essa ação não pode ser desfeita.")) {
    DB.limparTudo();
    updateDashboard();
  }
}

function exportarBanco() {
  const bytes = DB.exportarArquivo();
  const blob = new Blob([bytes], { type: 'application/x-sqlite3' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `meus_simulados_${new Date().getTime()}.sqlite`;
  document.body.appendChild(a); a.click(); a.remove();
}

function importarJsonLegado(e) {
  const file = e.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = function (ev) {
    try {
      const lista = JSON.parse(ev.target.result);
      if (!Array.isArray(lista)) { alert('Arquivo inválido: esperava um array de questões.'); return; }
      const resultado = DB.importarListaLegada(lista);
      alert(`Importação concluída!\n✅ ${resultado.inseridas} questões novas importadas.\n⏭️ ${resultado.ignoradas} ignoradas (duplicadas ou incompletas).`);
      updateDashboard();
      e.target.value = "";
    } catch (err) { alert("Erro ao ler o JSON: " + err.message); }
  };
  r.readAsText(file);
}

function importarBanco(e) {
  const file = e.target.files[0]; if (!file) return;
  const r = new FileReader();
  r.onload = async function (ev) {
    try {
      await DB.importarArquivo(new Uint8Array(ev.target.result));
      alert("Banco importado com sucesso!");
      updateDashboard();
      e.target.value = "";
    } catch (err) { alert("Erro ao importar o arquivo .sqlite: " + err.message); }
  };
  r.readAsArrayBuffer(file);
}

// ---------- Dashboard ----------
function classificarDesempenho(pct) {
  if (pct >= 70) return { label: 'Ponto forte', css: 'tag-forte' };
  if (pct >= 40) return { label: 'Atenção', css: 'tag-atencao' };
  return { label: 'Prioridade', css: 'tag-prioridade' };
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function slugify(str) {
  return String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'disc';
}

function toggleBloco(id) {
  const body = document.getElementById(`body-${id}`);
  const chev = document.getElementById(`chev-${id}`);
  if (!body) return;
  body.classList.toggle('collapsed');
  if (chev) chev.classList.toggle('open', !body.classList.contains('collapsed'));
}

const disciplinaAberta = {};
const filtroDisciplina = {};

function toggleDisciplina(exameKey, slug) {
  const key = `${exameKey}::${slug}`;
  disciplinaAberta[key] = !disciplinaAberta[key];
  updateDashboard();
}
function setFiltroDisciplina(exameKey, slug, filtro) {
  const key = `${exameKey}::${slug}`;
  filtroDisciplina[key] = filtro;
  disciplinaAberta[key] = true;
  updateDashboard();
}

function iniciarRevisaoOffline(exameKey, lista) {
  if (!lista.length) { alert('Nenhuma questão encontrada para essa revisão.'); return; }
  currentExam = exameKey;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.exam === exameKey));
  quizAtual = lista.map(q => ({ exame: exameKey, disciplina: q.disciplina, enunciado: q.enunciado, alts: q.alts, gab: q.gab, exp: q.exp }));
  respostasUsuario = {};
  provaIniciada = false;
  cancelarGeracao = false;
  montarProva(quizAtual.length);
}

function refazerQuestao(exameKey, questaoId) {
  const q = DB.getQuestaoPorId(questaoId);
  if (!q) return alert('Essa questão não foi encontrada no banco local (pode ter sido apagada).');
  iniciarRevisaoOffline(exameKey, [q]);
}
function refazerDisciplina(exameKey, disciplinaNome, somenteErradas) {
  const lista = DB.getQuestoesPorResultado(exameKey, disciplinaNome, somenteErradas ? 'errado' : null);
  iniciarRevisaoOffline(exameKey, lista);
}

function updateDashboard() {
  try {
    document.getElementById('dashTotalQ').textContent = DB.countQuestoesBanco();
    const resumo = DB.getResumoGeral();
    document.getElementById('dashAcertos').textContent = resumo.totalResp > 0 ? resumo.pct + '%' : '0%';
  } catch (e) { console.error('[Dashboard] erro no resumo geral:', e); }

  try {
    const hist = DB.getHistoricoSimulados(30);
    const histBox = document.getElementById('dashHistorico');
    histBox.innerHTML = !hist.length
      ? '<p class="small" style="color: var(--text-light);">Nenhum simulado registrado ainda.</p>'
      : hist.map(h => {
        const nomeExame = EDITAIS[h.exame] ? `${EDITAIS[h.exame].nome} (${EDITAIS[h.exame].banca})` : (h.exame || '—');
        const pctNum = Number(h.pct) || 0;
        const detalhe = h.liquido !== null && h.liquido !== undefined
          ? `${h.acertos || 0}C/${h.erros || 0}E/${h.brancos || 0}branco — líquido ${h.liquido} (${pctNum.toFixed(1)}%)`
          : `${h.acertos || 0}/${h.total || 0} (${pctNum.toFixed(1)}%)`;
        const dataLabel = h.data ? new Date(h.data).toLocaleString('pt-BR') : '—';
        return `<div class="hist-row"><span>${dataLabel} — ${nomeExame}</span><span>${detalhe}</span></div>`;
      }).join('');
  } catch (e) {
    console.error('[Dashboard] erro ao renderizar histórico:', e);
    const histBox = document.getElementById('dashHistorico');
    if (histBox) histBox.innerHTML = '<p class="small" style="color: var(--danger);">Erro ao carregar o histórico — veja o console (F12).</p>';
  }

  try {
    const cadernosBox = document.getElementById('dashCadernos');
    const LIMITE_LISTA = 40;
    let cadernosHtml = '';

    Object.keys(EDITAIS).forEach(examKey => {
      const exame = EDITAIS[examKey];
      const linhasBrutas = DB.getDesempenhoPorDisciplina(examKey);
      let corpo;
      if (!linhasBrutas.length) {
        corpo = `<p class="small" style="color: var(--text-light);">Faça um simulado de ${exame.nome} para ver seu caderno de desempenho.</p>`;
      } else {
        const isCebraspe = exame.tipo === 'certo_errado';
        const linhas = linhasBrutas.map(s => {
          const acertos = s.acertos || 0, erros = s.erros || 0, brancos = s.brancos || 0;
          const totalD = acertos + erros + brancos;
          const base = isCebraspe ? Math.max(0, acertos - erros) : acertos;
          const pct = totalD ? Math.round((base / totalD) * 100) : 0;
          const cls = classificarDesempenho(pct);
          const detalhe = isCebraspe
            ? `${acertos}C / ${erros}E / ${brancos}branco — líquido ${base} de ${totalD}`
            : `${acertos} acertos de ${totalD}`;
          return { k: s.disciplina, pct, cls, detalhe };
        }).sort((a, b) => a.pct - b.pct);

        const prioridades = linhas.filter(l => l.cls.label === 'Prioridade').map(l => l.k);

        corpo = linhas.map(l => {
          const slug = slugify(l.k);
          const key = `${examKey}::${slug}`;
          const aberta = !!disciplinaAberta[key];
          const itensDisc = DB.getHistoricoQuestoesPorDisciplina(examKey, l.k);
          const filtroAtual = filtroDisciplina[key] || 'todas';
          let itensFiltrados = itensDisc.filter(item => filtroAtual === 'certo' ? item.ultimoResultado === 'certo'
            : filtroAtual === 'errado' ? item.ultimoResultado === 'errado' : true);
          const totalFiltrado = itensFiltrados.length;
          const truncado = totalFiltrado > LIMITE_LISTA;
          itensFiltrados = itensFiltrados.slice(0, LIMITE_LISTA);
          const certasCount = itensDisc.filter(i => i.ultimoResultado === 'certo').length;
          const erradasCount = itensDisc.filter(i => i.ultimoResultado === 'errado').length;

          const listaHtml = !itensDisc.length
            ? `<p class="small" style="color: var(--text-light);">Sem questões registradas ainda nesta disciplina.</p>`
            : `<div class="qhist-filters">
                <div class="chip ${filtroAtual === 'todas' ? 'active' : ''}" data-acao="filtro-disc" data-exame="${examKey}" data-slug="${slug}" data-filtro="todas">Todas (${itensDisc.length})</div>
                <div class="chip ${filtroAtual === 'certo' ? 'active' : ''}" data-acao="filtro-disc" data-exame="${examKey}" data-slug="${slug}" data-filtro="certo">Só as que acertei (${certasCount})</div>
                <div class="chip ${filtroAtual === 'errado' ? 'active' : ''}" data-acao="filtro-disc" data-exame="${examKey}" data-slug="${slug}" data-filtro="errado">Só as que errei (${erradasCount})</div>
                <div style="flex:1;"></div>
                <button class="btn btn-outline btn-small" data-acao="refazer-disc-erradas" data-exame="${examKey}" data-disc="${escapeHtml(l.k)}" ${erradasCount ? '' : 'disabled'}>🔁 Refazer erradas</button>
                <button class="btn btn-outline btn-small" data-acao="refazer-disc-todas" data-exame="${examKey}" data-disc="${escapeHtml(l.k)}">🔁 Refazer todas (offline)</button>
              </div>
              ${itensFiltrados.map(item => {
                const ok = item.ultimoResultado === 'certo';
                const enun = item.questao.enunciado;
                const snippet = escapeHtml(enun).slice(0, 110) + (enun.length > 110 ? '…' : '');
                return `<div class="qhist-row">
                  <span class="qhist-tag ${ok ? 'ok' : 'bad'}">${ok ? '✅ Acertei' : '❌ Errei'}</span>
                  <span class="qhist-text">${snippet}</span>
                  <button class="btn btn-outline btn-small" data-acao="refazer-questao" data-exame="${examKey}" data-id="${item.questao.id}">🔁 Refazer</button>
                </div>`;
              }).join('')}
              ${truncado ? `<p class="small" style="color: var(--text-light); margin-top:8px;">Mostrando as ${LIMITE_LISTA} mais recentes de ${totalFiltrado}.</p>` : ''}`;

          return `<div class="disciplina-block">
              <div class="caderno-titulo" style="cursor:pointer;" data-acao="toggle-disciplina" data-exame="${examKey}" data-slug="${slug}">
                  <span>${l.k} <span class="caderno-chevron ${aberta ? 'open' : ''}" style="margin-left:4px;">▶</span></span>
                  <span class="${l.cls.css}">${l.cls.label}</span>
              </div>
              <div class="bar-row" style="margin:0 0 4px;">
                  <div class="bar-track"><div class="bar-fill" style="width:${l.pct}%"></div></div>
                  <div class="bar-pct">${l.pct}%</div>
              </div>
              <div class="small" style="color:var(--text-light); margin-bottom:8px;">${l.detalhe}</div>
              <div class="qhist-section ${aberta ? '' : 'collapsed'}" style="margin-top:8px; padding-top:10px;">${listaHtml}</div>
          </div>`;
        }).join('');

        if (prioridades.length) {
          corpo = `<div class="small" style="color:var(--danger); margin-bottom:10px;"><b>Foque em:</b> ${prioridades.join(', ')}</div>` + corpo;
        }
      }

      cadernosHtml += `<div class="card" style="margin-top:20px;">
          <div class="caderno-header" data-acao="toggle-caderno" data-exame="${examKey}">
              <h2 class="card-title" style="margin:0;">📓 Caderno de Desempenho — ${exame.nome} (${exame.banca})</h2>
              <span class="caderno-chevron open" id="chev-caderno-${examKey}">▶</span>
          </div>
          <div class="caderno-body" id="body-caderno-${examKey}">${corpo}</div>
      </div>`;
    });
    cadernosBox.innerHTML = cadernosHtml;
  } catch (e) {
    console.error('[Dashboard] erro ao renderizar caderno de desempenho:', e);
    const cadernosBox = document.getElementById('dashCadernos');
    if (cadernosBox) cadernosBox.innerHTML = '<div class="card"><p class="small" style="color: var(--danger);">Erro ao carregar o caderno de desempenho — veja o console (F12).</p></div>';
  }
}

// ---------- Rede: timeout + validação ----------
// Endpoints compatíveis com o formato OpenAI (chat/completions e listagem de modelos)
const ENDPOINTS_OPENAI_COMPAT = {
  groq:       { chat: 'https://api.groq.com/openai/v1/chat/completions', models: 'https://api.groq.com/openai/v1/models' },
  openai:     { chat: 'https://api.openai.com/v1/chat/completions',      models: 'https://api.openai.com/v1/models' },
  openrouter: { chat: 'https://openrouter.ai/api/v1/chat/completions',   models: 'https://openrouter.ai/api/v1/models' },
  mistral:    { chat: 'https://api.mistral.ai/v1/chat/completions',      models: 'https://api.mistral.ai/v1/models' },
  deepseek:   { chat: 'https://api.deepseek.com/chat/completions',       models: 'https://api.deepseek.com/models' }
};

function descreverDificuldade(diff) {
  return ({
    facil: 'nível FÁCIL (conceitos básicos e cobrança direta da lei/definição)',
    moderada: 'nível MODERADO (aplicação do conteúdo em situações simples)',
    dificil: 'nível DIFÍCIL (padrão de prova de banca, com detalhes técnicos e exceções)',
    mista: 'dificuldade MISTA (distribua em partes iguais entre fácil, moderada e difícil)'
  })[diff] || `nível ${diff}`;
}

// Lê a resposta HTTP e, se vier erro (incluindo 429 de cota), lança um Error com o status anexado.
async function lerRespostaJson(res) {
  let data = null;
  try { data = await res.json(); } catch (e) { /* corpo vazio ou não-JSON */ }
  if (!res.ok || (data && data.error)) {
    const detalhe = data && (data.error && (data.error.message || data.error) || data.message) || res.statusText || 'erro desconhecido';
    const err = new Error(`HTTP ${res.status}: ${typeof detalhe === 'string' ? detalhe : JSON.stringify(detalhe)}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function fetchComTimeout(url, opts, timeoutMs = 30000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: controller.signal }); }
  catch (e) { if (e.name === 'AbortError') throw new Error('A requisição demorou demais e foi cancelada (timeout).'); throw e; }
  finally { clearTimeout(id); }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function validarQuestao(q, isCebraspe) {
  if (!q || typeof q.enunciado !== 'string' || !q.enunciado.trim()) return false;
  if (!Array.isArray(q.alts) || q.alts.length < 2) return false;
  if (!q.alts.every(a => a && typeof a.l === 'string' && typeof a.t === 'string')) return false;
  if (isCebraspe && !['C', 'E'].includes(q.gab)) return false;
  if (!isCebraspe && !['A', 'B', 'C', 'D', 'E'].includes(q.gab)) return false;
  return true;
}

function calcularPontuacao(exameKey, lista, respostas) {
  const isCebraspe = EDITAIS[exameKey].tipo === 'certo_errado';
  let acertos = 0, erros = 0, brancos = 0;
  lista.forEach((q, idx) => {
    const r = respostas[idx];
    if (r === undefined) { brancos++; return; }
    if (r === q.gab) acertos++; else erros++;
  });
  const total = lista.length;
  if (isCebraspe) {
    const liquido = Math.max(0, acertos - erros);
    const pct = total ? (liquido / total) * 100 : 0;
    return { isCebraspe, acertos, erros, brancos, total, liquido, pct, pontuacao: liquido };
  }
  const pct = total ? (acertos / total) * 100 : 0;
  return { isCebraspe, acertos, erros, brancos, total, pct, pontuacao: acertos };
}

async function extrairTextoPDF(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async function () {
      try {
        const typedarray = new Uint8Array(this.result);
        const pdf = await pdfjsLib.getDocument(typedarray).promise;
        let fullText = "";
        const maxPages = Math.min(pdf.numPages, 12);
        for (let i = 1; i <= maxPages; i++) {
          document.getElementById('loader').textContent = `Lendo PDF: Página ${i} de ${maxPages}...`;
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          fullText += textContent.items.map(item => item.str).join(" ") + "\n";
        }
        resolve(fullText);
      } catch (e) { reject("Erro ao ler o PDF: " + e.message); }
    };
    reader.readAsArrayBuffer(file);
  });
}

// ---------- Fluxo principal de geração ----------
async function iniciarSimulado(viaIA) {
  if (selectedDisc.size === 0) return alert("Selecione disciplinas.");
  const countTotal = lerQuantidade();
  const materias = Array.from(selectedDisc);

  if (viaIA) {
    const fallbackAtivo = LS.getItem('fallback_ativo') !== '0';
    let prov, apiKey, apiModel;
    if (fallbackAtivo) {
      if (!listaProvedoresParaFallback().length) { alert("Nenhum provedor de IA configurado e ativo. Configure pelo menos um (chave + modelo) em \"Configurar API\"."); return switchView('config'); }
    } else {
      prov = LS.getItem('ai_provider') || 'gemini';
      apiKey = LS.getItem(`api_key_${prov}`);
      apiModel = LS.getItem(`api_model_${prov}`);
      if (!apiKey || !apiModel) { alert("Configure e salve um modelo da API."); return switchView('config'); }
    }

    document.getElementById('btnGenAI').disabled = true;
    const loaderDiv = document.getElementById('loader');
    loaderDiv.classList.remove('hidden');

    let pdfContext = "";
    let modoTranscricao = false;
    const fileInput = document.getElementById('pdfUpload');
    if (fileInput.files.length > 0) {
      loaderDiv.textContent = "Preparando leitura do PDF...";
      try {
        const textoPDF = await extrairTextoPDF(fileInput.files[0]);
        const limiteTexto = textoPDF.substring(0, 10000);
        const pdfModeVal = document.getElementById('pdfMode').value;
        if (pdfModeVal === 'transcricao') { modoTranscricao = true; pdfContext = limiteTexto; }
        else if (pdfModeVal === 'edital') pdfContext = `\n\nBaseie ESTRITAMENTE neste EDITAL:\n---\n${limiteTexto}`;
        else pdfContext = `\n\nBaseie dificuldade e estilo ESTRITAMENTE nesta PROVA:\n---\n${limiteTexto}`;
      } catch (e) {
        alert(e); document.getElementById('btnGenAI').disabled = false; loaderDiv.classList.add('hidden'); return;
      }
    }

    quizAtual = [];
    respostasUsuario = {};
    provaIniciada = false;
    cancelarGeracao = false;
    const enunciadosVistos = [];
    let primeiroLoteExibido = false;
    const TAMANHO_LOTE = 5;
    const MAX_FALHAS_CONSECUTIVAS = 5;
    let falhasConsecutivas = 0;
    let paradoPorFalhas = false;

    while (quizAtual.length < countTotal) {
      if (cancelarGeracao) break;
      const restantes = countTotal - quizAtual.length;
      const qtdLote = Math.min(TAMANHO_LOTE, restantes);
      const deNumero = quizAtual.length + 1;
      const ateNumero = quizAtual.length + qtdLote;
      const acaoVerbo = modoTranscricao ? 'Transcrevendo' : 'Gerando';
      const msg = !primeiroLoteExibido
        ? `Conectando à IA... ${acaoVerbo} as ${qtdLote} primeiras questões...`
        : (qtdLote > 1 ? `${acaoVerbo} questões ${deNumero} a ${ateNumero} de ${countTotal}...` : `${acaoVerbo} questão ${deNumero} de ${countTotal}...`);

      loaderDiv.innerHTML = `<span class="spinner"></span> ${msg}`;
      const progLabel = document.getElementById('progressLabel');
      if (progLabel) progLabel.textContent = msg;

      try {
        let lote;
        const usarPlano = !modoTranscricao && planoEnem && currentExam === 'enem' && planoEnem.total === countTotal;
        const slotsLote = usarPlano ? planoEnem.lista.slice(quizAtual.length, quizAtual.length + qtdLote) : null;
        if (fallbackAtivo) {
          const resultado = await gerarQuestoesComFallback(qtdLote, document.getElementById('qDiff').value, materias, currentExam, pdfContext, enunciadosVistos, modoTranscricao, slotsLote,
            (provTentativa, modeloTentativa) => {
              if (progLabel) progLabel.textContent = `${msg} (tentando ${PROVEDORES_INFO[provTentativa]} · ${modeloTentativa}...)`;
            });
          lote = resultado.questoes;
          loaderDiv.innerHTML = `<span class="spinner"></span> ${msg} <span class="small" style="color:var(--text-light);">(via ${PROVEDORES_INFO[resultado.provedorUsado]} · ${escapeHtml(resultado.modeloUsado)})</span>`;
        } else {
          lote = await gerarQuestoes(prov, apiKey, apiModel, qtdLote, document.getElementById('qDiff').value, materias, currentExam, pdfContext, enunciadosVistos, modoTranscricao, slotsLote);
        }
        lote = lote.slice(0, qtdLote); // a IA às vezes devolve questões a mais
        if (cancelarGeracao) break;
        falhasConsecutivas = 0;
        lote.forEach(q => enunciadosVistos.push(q.enunciado));
        DB.insertQuestoes(currentExam, lote);

        if (!primeiroLoteExibido) {
          quizAtual = lote;
          montarProva(countTotal);
          primeiroLoteExibido = true;
        } else {
          const startIdx = quizAtual.length;
          quizAtual = quizAtual.concat(lote);
          await anexarQuestoesEscalonado(lote, startIdx, countTotal);
        }
        gerandoEmSegundoPlano = quizAtual.length < countTotal;
        atualizarProgresso(countTotal);
        updateDashboard();
        salvarSessao();
        if (gerandoEmSegundoPlano) await sleep(500);
      } catch (err) {
        falhasConsecutivas++;
        if (falhasConsecutivas >= MAX_FALHAS_CONSECUTIVAS) {
          loaderDiv.innerHTML = `❌ Muitas falhas seguidas (${err.message}). Geração interrompida — pode ser limite de requisições da API. Tente novamente em alguns minutos ou troque de provedor/modelo.`;
          paradoPorFalhas = true;
          break;
        }
        const espera = Math.min(2000 * falhasConsecutivas, 10000);
        loaderDiv.innerHTML = `⚠️ Falha ao gerar lote (${err.message}). Tentando novamente em ${Math.round(espera / 1000)}s (${falhasConsecutivas}/${MAX_FALHAS_CONSECUTIVAS})...`;
        await sleep(espera);
      }
    }

    gerandoEmSegundoPlano = false;
    atualizarProgresso(countTotal);

    if (!primeiroLoteExibido) {
      alert("Não foi possível gerar nenhuma questão. Verifique sua chave/modelo de API.");
      loaderDiv.classList.add('hidden');
    } else if (cancelarGeracao) {
      loaderDiv.innerHTML = `🛑 Geração encerrada pelo usuário: ${quizAtual.length}/${countTotal} questões.`;
      setTimeout(() => loaderDiv.classList.add('hidden'), 3000);
    } else if (paradoPorFalhas) {
      loaderDiv.innerHTML = `❌ Geração parada por falhas repetidas: ${quizAtual.length}/${countTotal} questões disponíveis. Você já pode iniciar com essas.`;
    } else {
      loaderDiv.innerHTML = `✅ Simulado completo: ${quizAtual.length}/${countTotal} questões.`;
      setTimeout(() => loaderDiv.classList.add('hidden'), 3000);
    }
    document.getElementById('btnGenAI').disabled = false;

    if (cancelarGeracao && finalizarAoEncerrar) {
      finalizarAoEncerrar = false;
      finalizarSimulado(true);
    }
  } else {
    const banco = DB.getQuestoesBanco(currentExam, materias);
    if (banco.length === 0) return alert("Banco local vazio para esta seleção.");
    quizAtual = selecionarComPrioridade(currentExam, banco, countTotal);
    respostasUsuario = {};
    provaIniciada = false;
    cancelarGeracao = false;
    montarProva(quizAtual.length);
  }
}

function atualizarProgresso(countTotal) {
  const box = document.getElementById('progressContainer');
  if (box) {
    if (gerandoEmSegundoPlano && provaIniciada) box.classList.remove('hidden');
    else box.classList.add('hidden');
  }
  if (!provaIniciada) atualizarStartInfo(countTotal);
}

// Envia um prompt ao provedor/modelo indicado e devolve o texto da resposta.
async function chamarProvedor(provider, apiKey, apiModel, prompt) {
  let textoResposta = "";
  if (provider === 'gemini') {
    const res = await fetchComTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${apiModel}:generateContent?key=${apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7 } })
    });
    const data = await lerRespostaJson(res);
    textoResposta = data.candidates[0].content.parts[0].text;
  } else if (provider === 'cohere') {
    const res = await fetchComTimeout('https://api.cohere.com/v2/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: apiModel, messages: [{ role: 'user', content: prompt }], temperature: 0.7 })
    });
    const data = await lerRespostaJson(res);
    textoResposta = (data.message && data.message.content || []).map(c => c.text || '').join('');
  } else if (ENDPOINTS_OPENAI_COMPAT[provider]) {
    const res = await fetchComTimeout(ENDPOINTS_OPENAI_COMPAT[provider].chat, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'HTTP-Referer': window.location.href },
      body: JSON.stringify({ model: apiModel, messages: [{ role: "system", content: "Você é um gerador de JSON puro. Evite caracteres especiais não escapados." }, { role: "user", content: prompt }], temperature: 0.7 })
    });
    const data = await lerRespostaJson(res);
    textoResposta = data.choices[0].message.content;
  } else {
    throw new Error('Provedor de IA desconhecido: ' + provider);
  }

  return textoResposta;
}

async function gerarQuestoes(provider, apiKey, apiModel, count, diff, materias, examKey, extraContext, enunciadosVistos, modoTranscricao, slots) {
  const edital = EDITAIS[examKey];
  const isCebraspe = edital.tipo === 'certo_errado';
  const nAlt = edital.alternativas || 5;
  const letras = 'ABCDE'.slice(0, nAlt).split('');
  let regrasAlts = isCebraspe
    ? `"alts": [{"l": "C", "t": "Certo"}, {"l": "E", "t": "Errado"}], "gab": "C" ou "E"`
    : `"alts": [${letras.map(l => `{"l": "${l}", "t": "..."}`).join(', ')}], "gab": ${letras.map(l => `"${l}"`).join(', ')}`;

  const instrucaoDisc = (slots && slots.length)
    ? `uma para cada item desta lista, NESTA ORDEM, usando exatamente o nome da disciplina no campo "disciplina": ${slots.map((d, i) => `${i + 1}) ${d}`).join('; ')}`
    : `das disciplinas: ${materias.join(', ')}`;

  let prompt;
  if (modoTranscricao) {
    prompt = `Você vai EXTRAIR e TRANSCREVER questões reais de um documento de prova (PDF), e NÃO criar questões novas.
REGRAS OBRIGATÓRIAS:
1. Copie o enunciado e cada alternativa EXATAMENTE como aparecem no texto abaixo — sem reformular, resumir, corrigir ou inventar nada. Preserve a redação, a pontuação e a ordem original.
2. Extraia até ${count} questões do documento que ainda NÃO estejam na lista de "já transcritas" (se houver). Se o documento tiver menos questões disponíveis que isso, retorne só as que encontrar (pode ser um array menor que ${count}, ou até vazio se não houver mais nenhuma).
3. O documento normalmente NÃO traz o gabarito. Nesse caso, determine você mesmo a alternativa tecnicamente correta com base no seu conhecimento, e explique o porquê no campo "exp".
4. Cada questão deve estar no formato compatível com a prova ${edital.banca}: ${isCebraspe ? 'apenas C ou E' : nAlt + ' alternativas ' + letras[0] + ' a ' + letras[letras.length - 1]}. Ignore no documento qualquer questão que não se encaixe nesse formato.
5. Para cada questão extraída, identifique a disciplina mais provável dentre: ${materias.join(', ')} (ou outra, se nenhuma dessas encaixar).
6. NUNCA use aspas duplas (") dentro dos valores de texto — troque por aspas simples (').
7. RETORNE APENAS UM ARRAY JSON VÁLIDO, sem Markdown, no formato:
[{"exame": "${examKey}", "disciplina": "Nome da disciplina", "enunciado": "Texto da questão EXATAMENTE como no documento", ${regrasAlts}, "exp": "Explicação do gabarito"}]

DOCUMENTO FORNECIDO:
---
${extraContext}
---`;
    if (enunciadosVistos && enunciadosVistos.length) prompt += `\n\nJá transcritas (não repetir): ${enunciadosVistos.slice(-25).join(' | ')}`;
  } else {
    prompt = `Atue como elaborador da banca ${edital.banca} para o concurso da ${edital.nome}.
${edital.estilo}
Gere EXATAMENTE ${count} questões com ${descreverDificuldade(diff)}, ${instrucaoDisc}.
REGRAS CRÍTICAS DE FORMATAÇÃO:
1. RETORNE EXATAMENTE UM ARRAY JSON VÁLIDO QUE COMEÇA COM [ E TERMINA COM ].
2. NUNCA use aspas duplas (") dentro dos valores de texto. Substitua todas as aspas duplas por aspas simples (') nos textos.
3. Não inclua Markdown (\`\`\`json).
Formato exigido:
[{"exame": "${examKey}", "disciplina": "Nome da disciplina", "enunciado": "Texto da questão limpo", ${regrasAlts}, "exp": "Explicação curta"}]`;
    if (enunciadosVistos && enunciadosVistos.length) prompt += `\n\nNão repita nem reformule levemente estes enunciados já usados neste simulado: ${enunciadosVistos.slice(-25).join(' | ')}`;
    if (extraContext) prompt += extraContext;
  }

  const textoResposta = await chamarProvedor(provider, apiKey, apiModel, prompt);

  let jsonSujo = textoResposta.replace(/```json/gi, '').replace(/```/g, '').trim();
  const startIndex = jsonSujo.indexOf('[');
  const endIndex = jsonSujo.lastIndexOf(']');
  if (startIndex !== -1 && endIndex !== -1) jsonSujo = jsonSujo.substring(startIndex, endIndex + 1);

  let lista;
  try { lista = JSON.parse(jsonSujo); } catch (e) { throw new Error('A IA retornou um JSON inválido.'); }
  if (!Array.isArray(lista)) throw new Error('Formato de resposta inesperado da IA.');

  const validas = lista.filter(q => validarQuestao(q, isCebraspe));
  if (!validas.length) throw new Error('Nenhuma questão retornada passou na validação de formato.');
  return validas;
}

// ---------- Cronômetro ----------
function inciarCronometro(tempoRestanteForcado) {
  clearInterval(timerInterval);
  const minutos = parseInt(document.getElementById('tempoSimulado').value);
  const container = document.getElementById('timerContainer');
  if (!minutos || minutos <= 0) { container.style.display = 'none'; return; }
  tempoInicial = minutos * 60;
  tempoRestante = (typeof tempoRestanteForcado === 'number') ? tempoRestanteForcado : tempoInicial;
  isTimerPaused = false;
  container.style.display = 'flex';
  atualizarBotoesTimer();
  atualizarDisplayCronometro();
  let ticks = 0;
  timerInterval = setInterval(() => {
    if (!isTimerPaused) {
      tempoRestante--;
      atualizarDisplayCronometro();
      ticks++;
      if (ticks % 5 === 0) salvarSessao();
      if (tempoRestante <= 0) {
        clearInterval(timerInterval);
        alert("⚠️ O TEMPO ESGOTOU! O simulado será corrigido automaticamente.");
        finalizarSimulado(true);
      }
    }
  }, 1000);
}
function pausarCronometro() { isTimerPaused = !isTimerPaused; atualizarBotoesTimer(); }
function reiniciarCronometro() { tempoRestante = tempoInicial; isTimerPaused = false; atualizarDisplayCronometro(); atualizarBotoesTimer(); }
function atualizarBotoesTimer() {
  document.getElementById('btnPauseTimer').textContent = isTimerPaused ? "▶️ Retomar" : "⏸ Pausar";
  document.getElementById('timerDisplay').style.opacity = isTimerPaused ? "0.5" : "1";
}
function atualizarDisplayCronometro() {
  const h = Math.floor(tempoRestante / 3600), m = Math.floor((tempoRestante % 3600) / 60), s = tempoRestante % 60;
  document.getElementById('timerDisplay').textContent = `⏱ ${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// ---------- Montagem da prova ----------
function blocoQuestaoHTML(q, idx) {
  return `<div class="q-block" id="q-${idx}">
      <div class="q-meta">Questão ${idx + 1} • ${escapeHtml(q.disciplina)}</div>
      <div class="q-text">${escapeHtml(q.enunciado).replace(/\n/g, '<br>')}</div>
      <div>${q.alts.map(a => `<div class="option" data-val="${a.l}" onclick="selecionarAlt(${idx}, '${a.l}')"><div class="opt-letter">${a.l})</div><div class="opt-text">${escapeHtml(a.t)}</div></div>`).join('')}</div>
      <div class="explanation" id="exp-${idx}"><strong>Gabarito: ${q.gab}</strong><br><br>${escapeHtml(q.exp).replace(/\n/g, '<br>')}</div>
  </div>`;
}

function montarProva(totalEsperado) {
  quizExameKey = currentExam;
  quizModoGabarito = (document.getElementById('modoGabarito') || {}).value || 'final';
  document.getElementById('quizTitle').dataset.total = totalEsperado || quizAtual.length;
  document.getElementById('quizTitle').textContent = `Simulado ${EDITAIS[currentExam].nome} (${EDITAIS[currentExam].banca})`;
  document.getElementById('quizContainer').innerHTML = quizAtual.map((q, idx) => blocoQuestaoHTML(q, idx)).join('');

  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  ['view-gerar', 'view-dashboard', 'view-config', 'view-redacao'].forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById('view-quiz').classList.remove('hidden');

  document.getElementById('startCard').classList.remove('hidden');
  atualizarStartInfo(totalEsperado);
  atualizarContadorRespondidas();
  document.querySelector('.main').scrollTo({ top: 0 });
}

async function anexarQuestoesEscalonado(lote, startIdx, countTotal) {
  const container = document.getElementById('quizContainer');
  const loaderDiv = document.getElementById('loader');
  const progLabel = document.getElementById('progressLabel');
  for (let j = 0; j < lote.length; j++) {
    const idx = startIdx + j;
    container.insertAdjacentHTML('beforeend', blocoQuestaoHTML(lote[j], idx));
    atualizarContadorRespondidas();
    const msg = `Exibindo questão ${idx + 1} de ${countTotal}...`;
    if (progLabel) progLabel.textContent = msg;
    if (loaderDiv && !loaderDiv.classList.contains('hidden')) loaderDiv.innerHTML = `<span class="spinner"></span> ${msg}`;
    if (!provaIniciada) atualizarStartInfo(document.getElementById('quizTitle').dataset.total);
    if (j < lote.length - 1) await sleep(350);
  }
}

function atualizarStartInfo(totalEsperado) {
  const info = document.getElementById('startInfo');
  if (!info) return;
  const total = totalEsperado || quizAtual.length;
  info.textContent = quizAtual.length >= total
    ? `${quizAtual.length} questões prontas.`
    : `${quizAtual.length}/${total} questões prontas (o restante continua sendo gerado em segundo plano — você já pode iniciar).`;
}

function startProva(tempoRestanteForcado) {
  provaIniciada = true;
  document.getElementById('startCard').classList.add('hidden');
  document.getElementById('quizContainer').classList.remove('hidden');
  document.getElementById('stickyToolbar').classList.remove('hidden');
  atualizarProgresso(parseInt(document.getElementById('quizTitle').dataset.total) || quizAtual.length);
  inciarCronometro(tempoRestanteForcado);
  atualizarContadorRespondidas();
  salvarSessao();
  document.querySelector('.main').scrollTo({ top: 0 });
}

function atualizarContadorRespondidas() {
  const el = document.getElementById('answeredCounter');
  if (!el) return;
  el.textContent = `${Object.keys(respostasUsuario).length}/${quizAtual.length} respondidas`;
}

// Mostra certo/errado e a explicação de uma questão e a trava (usado no modo "gabarito imediato")
function revelarQuestao(qIdx) {
  const q = quizAtual[qIdx];
  const bloco = document.getElementById(`q-${qIdx}`);
  if (!q || !bloco) return;
  const resp = respostasUsuario[qIdx];
  bloco.querySelectorAll('.option').forEach(o => {
    o.classList.add('disabled');
    const v = o.getAttribute('data-val');
    if (v === q.gab) o.classList.add('correct');
    else if (v === resp) o.classList.add('wrong');
  });
  const exp = document.getElementById(`exp-${qIdx}`);
  if (exp) exp.style.display = 'block';
}

function selecionarAlt(qIdx, valor) {
  if (document.getElementById('stickyToolbar').classList.contains('hidden')) return;
  if (quizModoGabarito === 'imediato' && respostasUsuario[qIdx] !== undefined) return; // já respondida e revelada
  respostasUsuario[qIdx] = valor;
  const b = document.getElementById(`q-${qIdx}`);
  b.querySelectorAll('.option').forEach(o => o.classList.remove('selected'));
  b.querySelector(`.option[data-val="${valor}"]`).classList.add('selected');
  if (quizModoGabarito === 'imediato') revelarQuestao(qIdx);
  atualizarContadorRespondidas();
  salvarSessao();
}

// ---------- Sessão (continua em localStorage: é estado efêmero da prova em andamento) ----------
function salvarSessao() {
  if (!quizAtual.length) return;
  try {
    const sessao = {
      currentExam, quizAtual, respostasUsuario, provaIniciada, modoGabarito: quizModoGabarito,
      countTotal: parseInt(document.getElementById('quizTitle').dataset.total) || quizAtual.length,
      tempoRestante, tempoInicial, savedAt: Date.now()
    };
    LS.setItem('sessao_ativa', JSON.stringify(sessao));
  } catch (e) { /* ignora silenciosamente */ }
}
function limparSessaoSalva() { LS.removeItem('sessao_ativa'); }

function verificarSessaoSalva() {
  const raw = LS.getItem('sessao_ativa');
  if (!raw) return;
  try {
    const s = JSON.parse(raw);
    if (!s.quizAtual || !s.quizAtual.length) { limparSessaoSalva(); return; }
    document.getElementById('resumeBanner').classList.remove('hidden');
    const nomeExame = EDITAIS[s.currentExam] ? EDITAIS[s.currentExam].nome : s.currentExam;
    const infoTempo = s.provaIniciada && s.tempoInicial ? `, ${Math.max(0, Math.round(s.tempoRestante / 60))} min restantes` : '';
    document.getElementById('resumeInfo').textContent = `${nomeExame} — ${s.quizAtual.length}/${s.countTotal} questões${infoTempo}`;
  } catch (e) { limparSessaoSalva(); }
}

function retomarSessao() {
  const raw = LS.getItem('sessao_ativa');
  if (!raw) return;
  let s; try { s = JSON.parse(raw); } catch (e) { limparSessaoSalva(); return; }
  if (!EDITAIS[s.currentExam]) { alert('O concurso dessa sessão foi excluído, então ela não pode ser retomada.'); descartarSessao(); return; }

  currentExam = s.currentExam;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.exam === currentExam));
  selectedDisc = new Set(EDITAIS[currentExam].disciplinas);
  renderChips();
  quizAtual = s.quizAtual;
  respostasUsuario = s.respostasUsuario || {};
  provaIniciada = false;
  document.getElementById('resumeBanner').classList.add('hidden');
  if (document.getElementById('modoGabarito')) document.getElementById('modoGabarito').value = s.modoGabarito || 'final';

  montarProva(s.countTotal);

  Object.keys(respostasUsuario).forEach(idx => {
    const b = document.getElementById(`q-${idx}`);
    if (!b) return;
    const val = respostasUsuario[idx];
    b.querySelectorAll('.option').forEach(o => o.classList.remove('selected'));
    const opt = b.querySelector(`.option[data-val="${val}"]`);
    if (opt) opt.classList.add('selected');
    if (quizModoGabarito === 'imediato') revelarQuestao(parseInt(idx, 10));
  });

  if (s.provaIniciada) startProva(typeof s.tempoRestante === 'number' ? s.tempoRestante : undefined);
  else atualizarContadorRespondidas();
}

function descartarSessao() { limparSessaoSalva(); document.getElementById('resumeBanner').classList.add('hidden'); }

function irParaHome() {
  isTimerPaused = true;
  clearInterval(timerInterval);
  salvarSessao();
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const navGerar = document.querySelector('.nav-item[onclick*="gerar"]');
  if (navGerar) navGerar.classList.add('active');
  ['view-dashboard', 'view-config', 'view-quiz', 'view-redacao'].forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById('view-gerar').classList.remove('hidden');
  verificarSessaoSalva();
  document.querySelector('.main').scrollTo({ top: 0 });
}

function encerrarSimuladoAgora() {
  if (!confirm("Isso vai parar a geração das questões restantes e corrigir o simulado agora, com o que você já tem. Deseja continuar?")) return;
  cancelarGeracao = true;
  if (provaIniciada) { finalizarAoEncerrar = true; }
  else { finalizarAoEncerrar = true; startProva(); }
}

// ---------- Correção ----------
function finalizarSimulado(forcar = false) {
  if (!provaIniciada) return;
  if (gerandoEmSegundoPlano && !forcar && !confirm("As questões restantes ainda estão sendo geradas em segundo plano (a IA continuará gerando para o banco mesmo depois da correção). Corrigir agora apenas o que você já respondeu?")) return;

  const brancosIdx = [];
  quizAtual.forEach((q, idx) => { if (respostasUsuario[idx] === undefined) brancosIdx.push(idx); });
  if (!forcar && brancosIdx.length) {
    const numeros = brancosIdx.map(i => i + 1).join(', ');
    if (!confirm(`Você deixou ${brancosIdx.length} questão(ões) em branco: Q${numeros}.\nDeseja finalizar mesmo assim?`)) return;
  }

  clearInterval(timerInterval);
  const exameKey = quizExameKey || currentExam;
  const resultado = calcularPontuacao(exameKey, quizAtual, respostasUsuario);
  window.__ultimoSalvamentoOk = undefined;

  try {
    quizAtual.forEach((q, idx) => {
      const resp = respostasUsuario[idx];
      const tipoResultado = resp === undefined ? 'branco' : (resp === q.gab ? 'certo' : 'errado');
      DB.registrarResposta(exameKey, q, tipoResultado);
    });
    DB.addHistoricoSimulado({
      exame: exameKey, data: Date.now(), total: resultado.total, acertos: resultado.acertos,
      erros: resultado.erros, brancos: resultado.brancos,
      liquido: resultado.isCebraspe ? resultado.liquido : null, pct: resultado.pct
    });
    limparSessaoSalva();
    window.__ultimoSalvamentoOk = DB.countHistoricoSimulados();
    console.log('[Meus Simulados] Histórico salvo no banco SQL. Total de registros agora:', window.__ultimoSalvamentoOk);
  } catch (e) {
    console.error('Falha ao salvar estatísticas/histórico do simulado:', e);
    alert('Atenção: houve um erro ao salvar o histórico deste simulado.\n\nDetalhe técnico: ' + e.message);
  }

  try {
    quizAtual.forEach((q, idx) => {
      const resp = respostasUsuario[idx];
      const bloco = document.getElementById(`q-${idx}`);
      if (!bloco) return;
      bloco.querySelectorAll('.option').forEach(o => {
        o.classList.add('disabled');
        const v = o.getAttribute('data-val');
        if (v === q.gab) o.classList.add('correct');
        else if (v === resp && resp !== q.gab) o.classList.add('wrong');
      });
      const exp = document.getElementById(`exp-${idx}`);
      if (exp) exp.style.display = 'block';
      if (resp === undefined) {
        bloco.classList.add('blank-question');
        const meta = bloco.querySelector('.q-meta');
        if (meta && !meta.querySelector('.blank-tag')) meta.insertAdjacentHTML('beforeend', '<span class="blank-tag">● NÃO RESPONDIDA</span>');
      }
    });

    document.getElementById('stickyToolbar').classList.add('hidden');

    const quizContainer = document.getElementById('quizContainer');
    let corpo;
    if (resultado.isCebraspe) {
      corpo = `<div class="score-grid">
          <div>✅ Certas: ${resultado.acertos}</div><div>❌ Erradas: ${resultado.erros}</div>
          <div>⬜ Em branco: ${resultado.brancos}</div><div>⚖️ Líquido (Certas − Erradas): ${resultado.liquido}</div>
      </div>
      <div class="score-big">${resultado.pct.toFixed(1)}%</div>
      <div class="small" style="color:var(--text-light);">Cálculo no padrão Cebraspe: cada item errado anula um item certo (mínimo zero); itens em branco não somam nem descontam pontos.</div>`;
    } else {
      corpo = `<div class="score-grid">
          <div>✅ Acertos: ${resultado.acertos}</div><div>❌ Erros: ${resultado.erros}</div>
          <div>⬜ Em branco: ${resultado.brancos}</div><div>📊 Total: ${resultado.total}</div>
      </div><div class="score-big">${resultado.pct.toFixed(1)}%</div>`;
    }
    let blancoHtml = '';
    if (brancosIdx.length) blancoHtml = `<div class="blank-list" style="margin-top:10px;">📝 Em branco: ${brancosIdx.map(i => `<a href="#q-${i}">Q${i + 1}</a>`).join('')}</div>`;

    let areaHtml = '';
    const porArea = resumoPorArea(exameKey, quizAtual, respostasUsuario);
    if (porArea && porArea.length) {
      areaHtml = `<div style="margin-top:14px;"><b>Desempenho por área</b>${porArea.map(a => {
        const pct = a.total ? Math.round((a.acertos / a.total) * 100) : 0;
        return `<div class="caderno-titulo" style="margin-top:10px;"><span>${escapeHtml(a.nome)}</span><span class="small">${a.acertos}/${a.total} (${pct}%)</span></div>
          <div class="bar-row" style="margin:0;"><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div></div>`;
      }).join('')}<p class="small" style="color:var(--text-light); margin-top:10px;">A nota oficial do ENEM usa a TRI (Teoria de Resposta ao Item), que pondera cada questão pela dificuldade e pela coerência das respostas. Por isso este simulado mostra o percentual de acertos por área, e não uma nota de 0 a 1000.</p></div>`;
    }

    const totalSalvosLabel = (typeof window.__ultimoSalvamentoOk === 'number')
      ? `<div class="small" style="color:var(--success); margin-top:8px;">💾 Salvo no banco (você já tem ${window.__ultimoSalvamentoOk} simulado(s) registrado(s) ao todo). Confira em Dashboard → Histórico de Simulados.</div>`
      : `<div class="small" style="color:var(--danger); margin-top:8px;">⚠️ Não foi possível confirmar o salvamento — veja o console (F12) para detalhes.</div>`;

    quizContainer.insertAdjacentHTML('afterbegin', `<div class="card" id="resultadoCard"><h2 class="card-title">🏁 Resultado do Simulado — ${EDITAIS[exameKey].nome} (${EDITAIS[exameKey].banca})</h2>${corpo}${areaHtml}${blancoHtml}${totalSalvosLabel}</div>`);
  } catch (e) {
    console.error('Falha ao renderizar o resultado do simulado:', e);
    alert('O simulado foi corrigido e salvo no banco (confira o Dashboard), mas houve um problema ao exibir os detalhes aqui na tela.');
  }

  updateDashboard();
  Nuvem.agendarAuto();
  document.querySelector('.main').scrollTo({ top: 0, behavior: 'smooth' });
}


// ============================================================
// Redação ENEM — tema gerado por IA + correção por competência
// ============================================================
let temaRedacaoAtual = null; // { tema, textos:[{titulo,texto}], proposta, livre? }

const COMPETENCIAS_ENEM = [
  'C1 · Domínio da norma culta',
  'C2 · Compreensão do tema e repertório',
  'C3 · Argumentação e projeto de texto',
  'C4 · Coesão textual',
  'C5 · Proposta de intervenção'
];

function extrairJsonObjeto(texto) {
  const t = String(texto || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a === -1 || b === -1) throw new Error('A IA não retornou um objeto JSON.');
  try { return JSON.parse(t.substring(a, b + 1)); } catch (e) { throw new Error('A IA retornou um JSON inválido.'); }
}

function renderTemaRedacao() {
  const box = document.getElementById('redTemaBox');
  const t = temaRedacaoAtual;
  if (!t) { box.innerHTML = ''; return; }
  const textos = (t.textos || []).map(x => `<div style="background:var(--bg-body); border:1px solid var(--border); border-radius:8px; padding:12px; margin-bottom:8px;">
      <div class="small" style="color:var(--primary); font-weight:700; margin-bottom:4px;">${escapeHtml(x.titulo || 'Texto motivador')}</div>
      <div style="font-size:.92rem; line-height:1.5;">${escapeHtml(x.texto)}</div></div>`).join('');
  box.innerHTML = `<div style="margin-top:8px;">
      <div style="font-size:1.15rem; font-weight:700; margin-bottom:10px;">${escapeHtml(t.tema)}</div>${textos}
      ${t.proposta ? `<p style="font-size:.9rem; line-height:1.5;"><b>Proposta:</b> ${escapeHtml(t.proposta)}</p>` : ''}
      ${(t.textos && t.textos.length) ? '<p class="small" style="color:var(--text-light);">Textos motivadores elaborados por IA para treino (não são trechos oficiais do INEP).</p>' : ''}
    </div>`;
}

function usarTemaLivre() {
  const v = document.getElementById('redTemaLivre').value.trim();
  if (v) { temaRedacaoAtual = { tema: v, textos: [], proposta: null, livre: true }; renderTemaRedacao(); }
  else if (temaRedacaoAtual && temaRedacaoAtual.livre) { temaRedacaoAtual = null; renderTemaRedacao(); }
}

async function gerarTemaRedacao() {
  const btn = document.getElementById('btnGerarTema'), status = document.getElementById('redStatusTema');
  btn.disabled = true; status.style.color = 'var(--text-light)'; status.textContent = 'Gerando tema...';
  const prompt = `Atue como a banca de redação do ENEM (INEP). Crie UMA proposta de redação inédita, no padrão do exame.
REGRAS:
1. "tema" em frase nominal, no estilo do ENEM (ex.: "Desafios para ...", "Caminhos para ..."), sobre questão social, científica, cultural ou política atual do Brasil.
2. Crie 3 textos motivadores curtos (3 a 6 linhas cada), ORIGINAIS. Não invente citações, números precisos com fonte, nem falas atribuídas a pessoas reais; use apenas informações amplamente conhecidas. Cada texto tem "titulo" e "texto".
3. "proposta" no formato padrão: "A partir da leitura dos textos motivadores e com base nos conhecimentos construídos ao longo de sua formação, redija texto dissertativo-argumentativo em modalidade escrita formal da língua portuguesa sobre o tema [TEMA], apresentando proposta de intervenção que respeite os direitos humanos. Selecione, organize e relacione, de forma coerente e coesa, argumentos e fatos para defesa de seu ponto de vista."
4. Troque aspas duplas dentro dos textos por aspas simples.
Retorne APENAS um objeto JSON válido, sem Markdown: {"tema":"...","textos":[{"titulo":"...","texto":"..."}],"proposta":"..."}`;
  try {
    const r = await rodarComIA(async (prov, key, modelo) => {
      const obj = extrairJsonObjeto(await chamarProvedor(prov, key, modelo, prompt));
      if (!obj.tema || !Array.isArray(obj.textos) || !obj.textos.length || !obj.proposta) throw new Error('Tema incompleto devolvido pela IA.');
      return obj;
    }, (prov, modelo) => { status.textContent = `Gerando tema (tentando ${PROVEDORES_INFO[prov] || prov} · ${modelo})...`; });
    temaRedacaoAtual = { tema: String(r.resultado.tema), textos: r.resultado.textos.map(x => ({ titulo: String(x.titulo || ''), texto: String(x.texto || '') })), proposta: String(r.resultado.proposta) };
    document.getElementById('redTemaLivre').value = '';
    renderTemaRedacao();
    status.style.color = 'var(--success)'; status.textContent = `Tema gerado (via ${PROVEDORES_INFO[r.provedorUsado]} · ${r.modeloUsado}).`;
  } catch (e) {
    status.style.color = 'var(--danger)'; status.textContent = '❌ ' + e.message;
  } finally { btn.disabled = false; }
}

function atualizarContadorRedacao() {
  const texto = document.getElementById('redTexto').value;
  const palavras = texto.trim() ? texto.trim().split(/\s+/).length : 0;
  const linhas = Math.ceil(texto.length / 80); // estimativa: ~80 caracteres por linha manuscrita
  const el = document.getElementById('redContador');
  const fora = texto.length > 0 && (linhas < 8 || linhas > 30);
  el.style.color = fora ? 'var(--warning)' : 'var(--text-light)';
  el.textContent = `${palavras} palavras · ${texto.length} caracteres · ≈ ${linhas} linhas manuscritas (estimativa; o ENEM exige de 8 a 30)`;
}

function validarCorrecao(obj) {
  if (!obj || !Array.isArray(obj.competencias) || obj.competencias.length < 5) throw new Error('Correção incompleta: faltam competências.');
  const comps = [1, 2, 3, 4, 5].map(id => {
    const c = obj.competencias.find(x => Number(x.id) === id) || obj.competencias[id - 1];
    const n = Number(c && c.nota);
    if (!c || !isFinite(n)) throw new Error(`Nota inválida na competência ${id}.`);
    return { id, nota: Math.max(0, Math.min(200, Math.round(n / 40) * 40)), comentario: String(c.comentario || '') };
  });
  const lista = v => (Array.isArray(v) ? v : []).map(String).slice(0, 8);
  const zerada = obj.zerada === true;
  return { competencias: comps, zerada, motivoZero: String(obj.motivoZero || ''), resumo: String(obj.resumo || ''),
           melhorias: lista(obj.melhorias), alertas: lista(obj.alertas), notaTotal: zerada ? 0 : comps.reduce((s, c) => s + c.nota, 0) };
}

function renderCorrecaoRedacao(c, tema, origem) {
  const linhas = c.competencias.map(x => {
    const pct = Math.round((x.nota / 200) * 100);
    return `<div class="caderno-titulo" style="margin-top:14px;"><span>${COMPETENCIAS_ENEM[x.id - 1]}</span><span><b>${x.nota}</b> / 200</span></div>
      <div class="bar-row" style="margin:0 0 6px;"><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div></div>
      <div class="small" style="color:var(--text-light); line-height:1.5;">${escapeHtml(x.comentario)}</div>`;
  }).join('');
  const lis = arr => arr.map(x => `<li style="margin-bottom:4px;">${escapeHtml(x)}</li>`).join('');
  document.getElementById('redResultado').innerHTML = `<div class="card" id="redResultadoCard">
      <h2 class="card-title">🏁 Correção da redação</h2>
      <div class="small" style="color:var(--text-light); margin-bottom:6px;">${escapeHtml(tema)}</div>
      ${c.zerada ? `<div style="color:var(--danger); font-weight:700; margin:8px 0;">Redação zerada: ${escapeHtml(c.motivoZero || 'critério de anulação identificado.')}</div>` : ''}
      <div class="score-big">${c.notaTotal} <span style="font-size:1rem; color:var(--text-light);">/ 1000</span></div>
      ${linhas}
      ${c.resumo ? `<p style="margin-top:16px; line-height:1.5;"><b>Resumo:</b> ${escapeHtml(c.resumo)}</p>` : ''}
      ${c.alertas.length ? `<div style="margin-top:10px; color:var(--warning);"><b>Alertas</b><ul style="margin:6px 0 0 18px;">${lis(c.alertas)}</ul></div>` : ''}
      ${c.melhorias.length ? `<div style="margin-top:10px;"><b>Como melhorar</b><ul style="margin:6px 0 0 18px;">${lis(c.melhorias)}</ul></div>` : ''}
      <p class="small" style="color:var(--text-light); margin-top:14px;">Estimativa feita por IA${origem ? ' (' + escapeHtml(origem) + ')' : ''}. A correção oficial é feita por dois corretores humanos e pode divergir; use como guia de estudo.</p>
    </div>`;
}

async function corrigirRedacao() {
  const status = document.getElementById('redStatus'), btn = document.getElementById('btnCorrigirRed');
  const texto = document.getElementById('redTexto').value.trim();
  status.style.color = 'var(--danger)';
  if (!temaRedacaoAtual) { status.textContent = 'Gere ou digite um tema antes de corrigir.'; return; }
  if (texto.length < 200) { status.textContent = 'Escreva um texto mais completo antes de corrigir (mínimo de ~200 caracteres).'; return; }
  btn.disabled = true; status.style.color = 'var(--text-light)'; status.textContent = 'Corrigindo...';

  const prompt = `Você é corretor de redação do ENEM, seguindo a Cartilha do Participante (INEP). Avalie a redação abaixo nas 5 competências, com nota em múltiplos de 40 (0, 40, 80, 120, 160 ou 200):
C1 — domínio da modalidade escrita formal da língua portuguesa (ortografia, acentuação, concordância, regência, pontuação, estrutura sintática, registro).
C2 — compreensão da proposta e repertório sociocultural produtivo e pertinente, dentro do tipo dissertativo-argumentativo.
C3 — seleção, relação, organização e interpretação de informações e argumentos em defesa de um ponto de vista (projeto de texto, autoria, consistência).
C4 — mecanismos linguísticos de coesão (conectivos, referenciação, progressão).
C5 — proposta de intervenção que respeite os direitos humanos: verifique os cinco elementos (agente, ação, meio/modo, finalidade, detalhamento) e a articulação com a discussão.
REGRAS: seja criterioso e realista, sem inflar notas. Se houver fuga total ao tema, texto que não seja dissertativo-argumentativo ou menos de 7 linhas, marque "zerada": true e explique em "motivoZero". Desrespeito aos direitos humanos zera apenas a C5. Justifique cada nota citando trechos curtos da redação. Troque aspas duplas dentro dos textos por aspas simples.
TEMA: ${temaRedacaoAtual.tema}
${temaRedacaoAtual.proposta ? 'PROPOSTA: ' + temaRedacaoAtual.proposta + '\n' : ''}REDAÇÃO:
---
${texto}
---
Retorne APENAS um objeto JSON válido, sem Markdown: {"competencias":[{"id":1,"nota":160,"comentario":"..."},{"id":2,"nota":120,"comentario":"..."},{"id":3,"nota":120,"comentario":"..."},{"id":4,"nota":160,"comentario":"..."},{"id":5,"nota":120,"comentario":"..."}],"zerada":false,"motivoZero":"","alertas":["..."],"resumo":"...","melhorias":["...","..."]}`;

  try {
    const r = await rodarComIA(async (prov, key, modelo) => validarCorrecao(extrairJsonObjeto(await chamarProvedor(prov, key, modelo, prompt))),
      (prov, modelo) => { status.textContent = `Corrigindo (tentando ${PROVEDORES_INFO[prov] || prov} · ${modelo})...`; });
    const origem = `${PROVEDORES_INFO[r.provedorUsado]} · ${r.modeloUsado}`;
    const correcao = Object.assign({}, r.resultado, { origem });
    DB.addRedacao({ tema: temaRedacaoAtual.tema, proposta: temaRedacaoAtual, texto, notaTotal: correcao.notaTotal, correcao });
    renderCorrecaoRedacao(correcao, temaRedacaoAtual.tema, origem);
    renderHistoricoRedacoes();
    status.style.color = 'var(--success)'; status.textContent = '💾 Correção salva no histórico.';
    Nuvem.agendarAuto();
    document.getElementById('redResultado').scrollIntoView({ behavior: 'smooth' });
  } catch (e) {
    status.style.color = 'var(--danger)'; status.textContent = '❌ ' + e.message;
  } finally { btn.disabled = false; }
}

function renderHistoricoRedacoes() {
  const box = document.getElementById('redHistorico');
  if (!box) return;
  const lista = DB.getRedacoes(30);
  box.innerHTML = !lista.length
    ? '<p class="small" style="color:var(--text-light);">Nenhuma redação corrigida ainda.</p>'
    : lista.map(r => `<div class="qhist-row">
        <span class="qhist-tag ${r.nota_total >= 700 ? 'ok' : r.nota_total >= 500 ? '' : 'bad'}" style="${r.nota_total >= 500 && r.nota_total < 700 ? 'color:var(--warning);' : ''}">${r.nota_total}</span>
        <span class="qhist-text">${escapeHtml(r.tema)} <span class="small" style="color:var(--text-light);">— ${new Date(r.criado_em).toLocaleString('pt-BR')}</span></span>
        <button class="btn btn-outline btn-small" onclick="verRedacao(${r.id})">Ver</button>
        <button class="btn btn-outline btn-small" onclick="excluirRedacaoSalva(${r.id})">Excluir</button>
      </div>`).join('');
}

function verRedacao(id) {
  const r = DB.getRedacaoPorId(id);
  if (!r) return alert('Redação não encontrada.');
  temaRedacaoAtual = r.proposta || { tema: r.tema, textos: [], proposta: null };
  document.getElementById('redTemaLivre').value = '';
  renderTemaRedacao();
  document.getElementById('redTexto').value = r.texto;
  atualizarContadorRedacao();
  renderCorrecaoRedacao(r.correcao, r.tema, r.correcao.origem);
  document.getElementById('redTemaBox').scrollIntoView({ behavior: 'smooth' });
}
function excluirRedacaoSalva(id) {
  if (!confirm('Excluir esta redação do histórico?')) return;
  DB.excluirRedacao(id);
  renderHistoricoRedacoes();
}
