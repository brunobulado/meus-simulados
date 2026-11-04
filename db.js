/* ============================================================
   db.js — Banco de dados SQLite real, rodando no navegador via
   WebAssembly (sql.js), persistido em IndexedDB.
   Expõe um objeto global `DB` com métodos síncronos de consulta
   (o SQLite roda em memória) e persistência assíncrona em segundo
   plano (debounced) sempre que algo é escrito.
   ============================================================ */

const SQLJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.4.0/dist/';
const IDB_NAME_BASE = 'meus_simulados_db'; // banco "antigo" (sem login) e prefixo dos bancos por usuário
let idbName = IDB_NAME_BASE;               // com login: meus_simulados_db_<uid>
const IDB_STORE = 'arquivos';
const IDB_KEY = 'sqlite_bin';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS questoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exame TEXT NOT NULL,
  disciplina TEXT,
  enunciado TEXT NOT NULL,
  alts_json TEXT NOT NULL,
  gab TEXT NOT NULL,
  exp TEXT,
  criado_em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_questoes_exame ON questoes(exame);
CREATE INDEX IF NOT EXISTS idx_questoes_exame_disc ON questoes(exame, disciplina);

CREATE TABLE IF NOT EXISTS respostas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  questao_id INTEGER NOT NULL REFERENCES questoes(id),
  exame TEXT NOT NULL,
  disciplina TEXT,
  ultimo_resultado TEXT NOT NULL, -- 'certo' | 'errado' | 'branco'
  vezes INTEGER NOT NULL DEFAULT 1,
  erros INTEGER NOT NULL DEFAULT 0,
  ultima_data INTEGER NOT NULL,
  UNIQUE(questao_id)
);
CREATE INDEX IF NOT EXISTS idx_respostas_exame_disc ON respostas(exame, disciplina);

CREATE TABLE IF NOT EXISTS historico_simulados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exame TEXT NOT NULL,
  data INTEGER NOT NULL,
  total INTEGER NOT NULL,
  acertos INTEGER NOT NULL,
  erros INTEGER NOT NULL,
  brancos INTEGER NOT NULL,
  liquido INTEGER,
  pct REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS redacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tema TEXT NOT NULL,
  proposta_json TEXT,
  texto TEXT NOT NULL,
  nota_total INTEGER NOT NULL,
  correcao_json TEXT NOT NULL,
  criado_em INTEGER NOT NULL
);
`;

// ---------- IndexedDB (armazenamento binário do arquivo .sqlite) ----------
function idbOpen(nome = idbName) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(nome, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key, nome = idbName) {
  const conn = await idbOpen(nome);
  return new Promise((resolve, reject) => {
    const tx = conn.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(key, value, nome = idbName) {
  const conn = await idbOpen(nome);
  return new Promise((resolve, reject) => {
    const tx = conn.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- Núcleo sql.js ----------
let sqlDb = null;
let SQL = null;
let saveTimer = null;

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const bytes = sqlDb.export();
      await idbSet(IDB_KEY, bytes);
    } catch (e) { console.error('[DB] falha ao persistir no IndexedDB:', e); }
  }, 400);
}

function run(sql, params = []) {
  sqlDb.run(sql, params);
  scheduleSave();
}
function queryAll(sql, params = []) {
  const stmt = sqlDb.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}
function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length ? rows[0] : null;
}

async function initDB(uid) {
  idbName = uid ? `${IDB_NAME_BASE}_${uid}` : IDB_NAME_BASE; // cada conta tem o seu próprio arquivo SQLite
  SQL = await initSqlJs({ locateFile: f => SQLJS_CDN + f });
  let bytes = null;
  try { bytes = await idbGet(IDB_KEY); } catch (e) { console.error('[DB] erro lendo IndexedDB:', e); }
  sqlDb = bytes ? new SQL.Database(new Uint8Array(bytes)) : new SQL.Database();
  sqlDb.run(SCHEMA_SQL);
  if (!bytes) scheduleSave(); // primeira vez: já grava o banco vazio criado
}

function rowToQuestao(r) {
  return { id: r.id, exame: r.exame, disciplina: r.disciplina, enunciado: r.enunciado, alts: JSON.parse(r.alts_json), gab: r.gab, exp: r.exp };
}

// ---------- API pública ----------
const DB = {
  ready: null, // Promise setada em DB.init()

  init(uid) { this.ready = initDB(uid); return this.ready; },

  // ---- Migração: dados salvos no navegador antes de existir login ----
  async lerBancoLegado() {
    try { return await idbGet(IDB_KEY, IDB_NAME_BASE); } catch (e) { return null; }
  },
  async gravarBancoDoUsuario(uid, bytes) {
    await idbSet(IDB_KEY, bytes, `${IDB_NAME_BASE}_${uid}`);
  },

  // ---- Banco de questões ----
  countQuestoesBanco() {
    return queryOne('SELECT COUNT(*) AS n FROM questoes').n;
  },

  // Insere questões novas evitando duplicar (mesmo exame + enunciado). Retorna quantas foram inseridas de fato.
  insertQuestoes(exame, lista) {
    let inseridas = 0;
    for (const q of lista) {
      if (!q || !q.enunciado) continue;
      const existente = queryOne('SELECT id FROM questoes WHERE exame = ? AND enunciado = ?', [exame, q.enunciado]);
      if (existente) continue;
      run('INSERT INTO questoes (exame, disciplina, enunciado, alts_json, gab, exp, criado_em) VALUES (?,?,?,?,?,?,?)',
        [exame, q.disciplina || null, q.enunciado, JSON.stringify(q.alts || []), q.gab, q.exp || '', Date.now()]);
      inseridas++;
    }
    return inseridas;
  },

  getQuestoesBanco(exame, disciplinas) {
    let sql = 'SELECT * FROM questoes WHERE exame = ?';
    const params = [exame];
    if (disciplinas && disciplinas.length) {
      sql += ` AND disciplina IN (${disciplinas.map(() => '?').join(',')})`;
      params.push(...disciplinas);
    }
    return queryAll(sql, params).map(rowToQuestao);
  },

  // Garante que a questão exista no banco (insere se faltar) e devolve o id.
  garantirQuestaoId(exame, q) {
    const existente = queryOne('SELECT id FROM questoes WHERE exame = ? AND enunciado = ?', [exame, q.enunciado]);
    if (existente) return existente.id;
    run('INSERT INTO questoes (exame, disciplina, enunciado, alts_json, gab, exp, criado_em) VALUES (?,?,?,?,?,?,?)',
      [exame, q.disciplina || null, q.enunciado, JSON.stringify(q.alts || []), q.gab, q.exp || '', Date.now()]);
    return queryOne('SELECT last_insert_rowid() AS id').id;
  },

  // ---- Respostas (histórico por questão, com upsert) ----
  registrarResposta(exame, q, resultado /* 'certo'|'errado'|'branco' */) {
    const questaoId = this.garantirQuestaoId(exame, q);
    const atual = queryOne('SELECT id, vezes, erros FROM respostas WHERE questao_id = ?', [questaoId]);
    if (atual) {
      run('UPDATE respostas SET ultimo_resultado=?, vezes=vezes+1, erros=erros+?, ultima_data=?, disciplina=? WHERE id=?',
        [resultado, resultado === 'errado' ? 1 : 0, Date.now(), q.disciplina || null, atual.id]);
    } else {
      run('INSERT INTO respostas (questao_id, exame, disciplina, ultimo_resultado, vezes, erros, ultima_data) VALUES (?,?,?,?,1,?,?)',
        [questaoId, exame, q.disciplina || null, resultado, resultado === 'errado' ? 1 : 0, Date.now()]);
    }
  },

  getPesosQuestoes(exame) {
    const rows = queryAll('SELECT questao_id, vezes, erros FROM respostas WHERE exame = ?', [exame]);
    const mapa = {};
    rows.forEach(r => { mapa[r.questao_id] = { vezes: r.vezes, erros: r.erros }; });
    return mapa;
  },

  getDesempenhoPorDisciplina(exame) {
    return queryAll(`
      SELECT disciplina,
        SUM(ultimo_resultado='certo') AS acertos,
        SUM(ultimo_resultado='errado') AS erros,
        SUM(ultimo_resultado='branco') AS brancos
      FROM respostas WHERE exame = ? AND disciplina IS NOT NULL
      GROUP BY disciplina`, [exame]);
  },

  getHistoricoQuestoesPorDisciplina(exame, disciplina) {
    return queryAll(`
      SELECT r.id AS resposta_id, r.ultimo_resultado, r.ultima_data,
             q.id AS questao_id, q.enunciado, q.alts_json, q.gab, q.exp, q.disciplina
      FROM respostas r JOIN questoes q ON q.id = r.questao_id
      WHERE r.exame = ? AND r.disciplina = ?
      ORDER BY r.ultima_data DESC`, [exame, disciplina])
      .map(r => ({
        respostaId: r.resposta_id, ultimoResultado: r.ultimo_resultado, ultimaData: r.ultima_data,
        questao: { id: r.questao_id, exame, disciplina: r.disciplina, enunciado: r.enunciado, alts: JSON.parse(r.alts_json), gab: r.gab, exp: r.exp }
      }));
  },

  getQuestoesPorResultado(exame, disciplina, resultado /* null = todas */) {
    let sql = `SELECT q.id, q.enunciado, q.alts_json, q.gab, q.exp, q.disciplina
               FROM respostas r JOIN questoes q ON q.id = r.questao_id
               WHERE r.exame = ? AND r.disciplina = ?`;
    const params = [exame, disciplina];
    if (resultado) { sql += ' AND r.ultimo_resultado = ?'; params.push(resultado); }
    return queryAll(sql, params).map(rowToQuestao);
  },

  // ---- Histórico de simulados ----
  addHistoricoSimulado(entry) {
    run('INSERT INTO historico_simulados (exame, data, total, acertos, erros, brancos, liquido, pct) VALUES (?,?,?,?,?,?,?,?)',
      [entry.exame, entry.data, entry.total, entry.acertos, entry.erros, entry.brancos, entry.liquido ?? null, entry.pct]);
  },
  getHistoricoSimulados(limit = 30) {
    return queryAll('SELECT * FROM historico_simulados ORDER BY data DESC LIMIT ?', [limit]);
  },
  countHistoricoSimulados() {
    return queryOne('SELECT COUNT(*) AS n FROM historico_simulados').n;
  },
  getQuestaoPorId(id) {
    const r = queryOne('SELECT * FROM questoes WHERE id = ?', [id]);
    return r ? rowToQuestao(r) : null;
  },
  getResumoGeral() {
    const r = queryOne(`SELECT SUM(total) AS totalResp, SUM(COALESCE(liquido, acertos)) AS totalPontos FROM historico_simulados`);
    const totalResp = r && r.totalResp ? r.totalResp : 0;
    const totalPontos = r && r.totalPontos ? r.totalPontos : 0;
    return { totalResp, pct: totalResp ? Math.round((totalPontos / totalResp) * 100) : 0 };
  },

  // Importa um backup antigo (array de questões em JSON, do formato usado antes da refatoração para SQL)
  importarListaLegada(lista) {
    let inseridas = 0, ignoradas = 0;
    for (const q of lista) {
      if (!q || !q.enunciado || !q.exame) { ignoradas++; continue; }
      const existente = queryOne('SELECT id FROM questoes WHERE exame = ? AND enunciado = ?', [q.exame, q.enunciado]);
      if (existente) { ignoradas++; continue; }
      run('INSERT INTO questoes (exame, disciplina, enunciado, alts_json, gab, exp, criado_em) VALUES (?,?,?,?,?,?,?)',
        [q.exame, q.disciplina || null, q.enunciado, JSON.stringify(q.alts || []), q.gab, q.exp || '', Date.now()]);
      inseridas++;
    }
    return { inseridas, ignoradas, total: lista.length };
  },

  // ---- Redações (módulo ENEM) ----
  addRedacao(r) {
    run('INSERT INTO redacoes (tema, proposta_json, texto, nota_total, correcao_json, criado_em) VALUES (?,?,?,?,?,?)',
      [r.tema, r.proposta ? JSON.stringify(r.proposta) : null, r.texto, r.notaTotal, JSON.stringify(r.correcao), Date.now()]);
    return queryOne('SELECT last_insert_rowid() AS id').id;
  },
  getRedacoes(limit = 30) {
    return queryAll('SELECT id, tema, nota_total, criado_em FROM redacoes ORDER BY criado_em DESC LIMIT ?', [limit]);
  },
  getRedacaoPorId(id) {
    const r = queryOne('SELECT * FROM redacoes WHERE id = ?', [id]);
    if (!r) return null;
    return { id: r.id, tema: r.tema, proposta: r.proposta_json ? JSON.parse(r.proposta_json) : null, texto: r.texto,
             notaTotal: r.nota_total, correcao: JSON.parse(r.correcao_json), criadoEm: r.criado_em };
  },
  excluirRedacao(id) { run('DELETE FROM redacoes WHERE id = ?', [id]); },

  // ---- Manutenção ----
  limparTudo() {
    run('DELETE FROM respostas'); run('DELETE FROM questoes'); run('DELETE FROM historico_simulados'); run('DELETE FROM redacoes');
    run("DELETE FROM sqlite_sequence WHERE name IN ('questoes','respostas','historico_simulados','redacoes')");
  },
  exportarArquivo() { return sqlDb.export(); },
  async importarArquivo(bytes) {
    sqlDb = new SQL.Database(new Uint8Array(bytes));
    sqlDb.run(SCHEMA_SQL); // garante que tabelas existam mesmo em arquivos antigos
    await idbSet(IDB_KEY, bytes);
  }
};
