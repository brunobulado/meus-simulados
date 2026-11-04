/* ============================================================
   nuvem.js — Backup do banco de dados na nuvem (Firestore).

   Por que Firestore e não Storage? O Cloud Storage do Firebase
   exige o plano Blaze (cartão vinculado); o Firestore tem cota
   gratuita no plano Spark.

   Como funciona: o arquivo SQLite é comprimido (gzip), convertido
   em texto (base64) e dividido em partes de ~700 KB (o limite de um
   documento do Firestore é 1 MiB). Estrutura:
     usuarios/{uid}/backup/meta        → resumo (nº de partes, data, totais)
     usuarios/{uid}/backup/parte_0..N  → pedaços do arquivo
   NÃO sobem: chaves de IA (ficam só no navegador).
   ============================================================ */

const Nuvem = {
  TAM_PARTE: 700000,   // caracteres base64 por documento
  MAX_PARTES: 19,      // precisa bater com a regra do firestore.rules (parte_0..parte_19)
  _timer: null,
  _ocupado: false,

  disponivel() {
    return !!(typeof Auth !== 'undefined' && Auth.usuario && typeof firebase !== 'undefined' && typeof firebase.firestore === 'function');
  },
  _col() { return firebase.firestore().collection('usuarios').doc(Auth.usuario.uid).collection('backup'); },

  // ---------- utilitários binários ----------
  async _fluxo(bytes, Transformador) {
    const resp = new Response(new Blob([bytes]).stream().pipeThrough(new Transformador('gzip')));
    return new Uint8Array(await resp.arrayBuffer());
  },
  async comprimir(bytes) {
    if (typeof CompressionStream === 'undefined') return { dados: bytes, comprimido: false };
    return { dados: await this._fluxo(bytes, CompressionStream), comprimido: true };
  },
  async descomprimir(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador não suporta descompressão (atualize o navegador).');
    return this._fluxo(bytes, DecompressionStream);
  },
  bytesParaBase64(u8) {
    let bin = '';
    for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(bin);
  },
  base64ParaBytes(b64) {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  },
  ehSqlite(u8) {
    const cab = 'SQLite format 3\0';
    if (u8.length < cab.length) return false;
    for (let i = 0; i < cab.length; i++) if (u8[i] !== cab.charCodeAt(i)) return false;
    return true;
  },

  traduzirErro(e) {
    const c = e && e.code;
    if (c === 'permission-denied') return 'Sem permissão no Firestore. Confira se as regras (firestore.rules) foram publicadas e se o seu e-mail está verificado.';
    if (c === 'unavailable') return 'Sem conexão com o Firestore. Verifique sua internet e tente de novo.';
    if (c === 'not-found' || c === 'failed-precondition') return 'O Firestore ainda não foi criado neste projeto (Console → Firestore Database → Criar banco de dados).';
    if (c === 'resource-exhausted') return 'A cota gratuita do Firestore de hoje acabou. Tente novamente amanhã.';
    return (e && e.message) || String(e);
  },

  // ---------- operações ----------
  async salvar() {
    if (!this.disponivel()) throw new Error('Backup na nuvem disponível só com login.');
    const bytes = DB.exportarArquivo();
    const { dados, comprimido } = await this.comprimir(bytes);
    const b64 = this.bytesParaBase64(dados);
    const partes = [];
    for (let i = 0; i < b64.length; i += this.TAM_PARTE) partes.push(b64.slice(i, i + this.TAM_PARTE));
    if (partes.length > this.MAX_PARTES + 1) throw new Error('O banco ficou grande demais para o backup na nuvem (limite aproximado de 13 MB comprimidos). Use "Exportar Banco (.sqlite)".');

    const col = this._col();
    const antigo = await col.doc('meta').get();
    const nAntigo = antigo.exists ? (antigo.data().partes || 0) : 0;

    const batch = firebase.firestore().batch(); // tudo ou nada: o backup antigo só é trocado se o novo gravar por inteiro
    partes.forEach((p, i) => batch.set(col.doc('parte_' + i), { i, dados: p }));
    for (let i = partes.length; i < nAntigo; i++) batch.delete(col.doc('parte_' + i));
    const meta = {
      partes: partes.length, comprimido, bytesOriginais: bytes.length, bytesEnviados: dados.length,
      totalQuestoes: DB.countQuestoesBanco(), totalSimulados: DB.countHistoricoSimulados(),
      concursosCustom: LS.getItem('concursos_custom') || '[]',
      atualizadoEm: Date.now(), formato: 'sqlite-gzip-base64-v1'
    };
    batch.set(col.doc('meta'), meta);
    await batch.commit();
    return meta;
  },

  async lerMeta() {
    if (!this.disponivel()) return null;
    const d = await this._col().doc('meta').get();
    return d.exists ? d.data() : null;
  },

  async restaurar() {
    if (!this.disponivel()) throw new Error('Backup na nuvem disponível só com login.');
    const meta = await this.lerMeta();
    if (!meta) throw new Error('Não há backup salvo na nuvem para esta conta.');
    const col = this._col();
    const docs = await Promise.all(Array.from({ length: meta.partes }, (_, i) => col.doc('parte_' + i).get()));
    docs.forEach((d, i) => { if (!d.exists) throw new Error(`Backup incompleto: falta a parte ${i + 1} de ${meta.partes}.`); });
    let bytes = this.base64ParaBytes(docs.map(d => d.data().dados).join(''));
    if (meta.comprimido) bytes = await this.descomprimir(bytes);
    if (!this.ehSqlite(bytes)) throw new Error('O backup baixado não é um arquivo SQLite válido. Nada foi alterado.');
    await DB.importarArquivo(bytes);
    if (meta.concursosCustom) LS.setItem('concursos_custom', meta.concursosCustom);
    return meta;
  },

  // ---------- interface ----------
  _fmt(ms) { return new Date(ms).toLocaleString('pt-BR'); },
  _kb(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; },
  _msg(texto, tipo) {
    const el = document.getElementById('nuvemMsg');
    if (!el) return;
    el.textContent = texto || '';
    el.style.color = tipo === 'ok' ? 'var(--success)' : tipo === 'erro' ? 'var(--danger)' : 'var(--text-light)';
  },
  _travar(v) { this._ocupado = v; ['nuvemSalvar', 'nuvemRestaurar'].forEach(id => { const b = document.getElementById(id); if (b) b.disabled = v; }); },

  async atualizarUI() {
    const card = document.getElementById('cardNuvem');
    if (!card) return;
    card.classList.toggle('hidden', !this.disponivel());
    if (!this.disponivel()) return;
    const auto = document.getElementById('nuvemAuto');
    if (auto) auto.checked = LS.getItem('nuvem_auto') === '1';
    const st = document.getElementById('nuvemStatus');
    try {
      const m = await this.lerMeta();
      st.textContent = m
        ? `Último backup: ${this._fmt(m.atualizadoEm)} · ${m.totalQuestoes} questões · ${m.totalSimulados} simulados · ${this._kb(m.bytesEnviados)}`
        : 'Nenhum backup na nuvem ainda.';
    } catch (e) { st.textContent = 'Não foi possível consultar o backup: ' + this.traduzirErro(e); }
  },

  async salvarUI() {
    if (this._ocupado) return;
    this._travar(true); this._msg('Enviando backup...');
    try { const m = await this.salvar(); this._msg(`Backup concluído (${m.totalQuestoes} questões, ${this._kb(m.bytesEnviados)}).`, 'ok'); await this.atualizarUI(); }
    catch (e) { this._msg('❌ ' + this.traduzirErro(e), 'erro'); }
    finally { this._travar(false); }
  },

  async restaurarUI() {
    if (this._ocupado) return;
    let m;
    try { m = await this.lerMeta(); } catch (e) { return this._msg('❌ ' + this.traduzirErro(e), 'erro'); }
    if (!m) return this._msg('Não há backup salvo na nuvem para esta conta.', 'erro');
    if (!confirm(`Restaurar o backup de ${this._fmt(m.atualizadoEm)} (${m.totalQuestoes} questões, ${m.totalSimulados} simulados)?\n\nISSO SUBSTITUI o banco deste navegador. Se quiser guardar o atual, use antes "Exportar Banco (.sqlite)".`)) return;
    this._travar(true); this._msg('Baixando e restaurando...');
    try {
      await this.restaurar();
      if (typeof carregarConcursosCustom === 'function') { carregarConcursosCustom(); renderExamTabs(); renderChips(); }
      updateDashboard();
      this._msg('Backup restaurado com sucesso.', 'ok');
    } catch (e) { this._msg('❌ ' + this.traduzirErro(e), 'erro'); }
    finally { this._travar(false); }
  },

  alternarAuto() {
    LS.setItem('nuvem_auto', document.getElementById('nuvemAuto').checked ? '1' : '0');
  },

  // Backup automático: agrupa várias alterações seguidas em um único envio (15 s depois da última)
  agendarAuto() {
    if (!this.disponivel() || LS.getItem('nuvem_auto') !== '1') return;
    clearTimeout(this._timer);
    this._timer = setTimeout(async () => {
      if (this._ocupado) return;
      this._ocupado = true;
      try { const m = await this.salvar(); this._msg(`Backup automático concluído (${this._fmt(m.atualizadoEm)}).`, 'ok'); this.atualizarUI(); }
      catch (e) { console.warn('[Nuvem] backup automático falhou:', e); this._msg('Backup automático falhou: ' + this.traduzirErro(e), 'erro'); }
      finally { this._ocupado = false; }
    }, 15000);
  },

  // Banco local vazio + backup na nuvem existente (ex.: primeiro acesso em outro computador) → oferece restaurar
  async oferecerRestauracaoInicial() {
    if (!this.disponivel()) return;
    try {
      if (DB.countQuestoesBanco() > 0 || DB.countHistoricoSimulados() > 0) return;
      const m = await this.lerMeta();
      if (!m) return;
      if (!confirm(`Encontramos um backup desta conta na nuvem (${this._fmt(m.atualizadoEm)} · ${m.totalQuestoes} questões · ${m.totalSimulados} simulados).\n\nDeseja restaurá-lo neste navegador?`)) return;
      await this.restaurar();
    } catch (e) { console.warn('[Nuvem] restauração inicial não realizada:', e); }
  }
};

function nuvemSalvar() { return Nuvem.salvarUI(); }
function nuvemRestaurar() { return Nuvem.restaurarUI(); }
function nuvemAlternarAuto() { return Nuvem.alternarAuto(); }
