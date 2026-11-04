/* ============================================================
   auth.js — Login e cadastro com Firebase Authentication.

   - LS: substitui o localStorage no app inteiro, guardando as
     preferências de cada conta com um prefixo (u_<uid>_). Assim,
     duas contas no mesmo navegador não misturam chaves de IA,
     concursos, sessão em andamento etc.
   - Auth: login com e-mail/senha e Google, cadastro, recuperação
     de senha e logout.
   - Sem Firebase configurado (firebase-config.js com "COLE_AQUI"),
     o app roda em MODO LOCAL, exatamente como antes do login.
   ============================================================ */

const LS = {
  prefix: '',
  getItem(k) { return localStorage.getItem(this.prefix + k); },
  setItem(k, v) { localStorage.setItem(this.prefix + k, v); },
  removeItem(k) { localStorage.removeItem(this.prefix + k); }
};

const Auth = {
  usuario: null,
  modoLocal: false,
  _auth: null,
  _iniciado: false,
  _modo: 'entrar', // 'entrar' | 'cadastrar'
  _aoEntrar: null,
  _checagem: null,
  _cooldown: null,

  // Opções de acesso (editáveis em firebase-config.js → window.APP_OPCOES)
  opcoes() {
    return Object.assign({ cadastroAberto: true, loginGoogle: true, exigirEmailVerificado: true, exigirChaveIA: true }, window.APP_OPCOES || {});
  },
  precisaVerificar(user) {
    return !!user && !user.emailVerified && (user.providerData || []).some(p => p.providerId === 'password');
  },
  _aplicarOpcoes() {
    const o = this.opcoes();
    const fechado = o.cadastroAberto === false;
    const semGoogle = fechado || o.loginGoogle === false; // Google criaria contas novas, o que "só por convite" não permite
    ['authTabs'].forEach(id => document.getElementById(id).classList.toggle('hidden', fechado));
    ['authGoogleBtn', 'authSep'].forEach(id => document.getElementById(id).classList.toggle('hidden', semGoogle));
    if (fechado) this.aba('entrar');
  },

  configurado() {
    const c = window.FIREBASE_CONFIG;
    return !!(c && c.apiKey && !/^COLE_AQUI/.test(c.apiKey)); // só verifica se o arquivo foi preenchido
  },

  // Chamado uma vez no carregamento da página. aoEntrar(usuario) inicia o app.
  iniciar(aoEntrar) {
    this._aoEntrar = aoEntrar;
    if (!this.configurado()) {
      this.modoLocal = true;
      LS.prefix = '';
      this._mostrarChip(null);
      this._esconderTelas();
      aoEntrar({ uid: null, email: null });
      return;
    }
    if (typeof firebase === 'undefined') { // configurado, mas o SDK não carregou: NÃO cai no modo local (isso pularia o login)
      this._mostrarTelaLogin();
      this._ocupado(true);
      this.msg('Não foi possível carregar o Firebase (conexão com a internet ou bloqueador de conteúdo). Recarregue a página.', 'erro');
      return;
    }
    this._aplicarOpcoes();
    try {
      if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
      this._auth = firebase.auth();
      this._auth.languageCode = 'pt-BR';
    } catch (e) {
      console.error('[Auth] falha ao iniciar o Firebase:', e);
      this._mostrarTelaLogin();
      this.msg('Não foi possível iniciar o Firebase. Confira o firebase-config.js. Detalhe: ' + e.message, 'erro');
      return;
    }
    this._auth.onAuthStateChanged(user => {
      if (user) {
        this.usuario = user;
        LS.prefix = `u_${user.uid}_`;
        document.getElementById('authScreen').classList.add('hidden');
        this._mostrarChip(user);
        if (this.opcoes().exigirEmailVerificado && this.precisaVerificar(user)) { this._mostrarTelaVerificacao(); return; }
        this._entrarNoApp();
      } else {
        this.usuario = null;
        LS.prefix = '';
        this._pararChecagem();
        document.getElementById('verifyScreen').classList.add('hidden');
        this._mostrarTelaLogin();
      }
    });
  },

  _entrarNoApp() {
    this._pararChecagem();
    document.getElementById('verifyScreen').classList.add('hidden');
    document.getElementById('dbLoading').classList.remove('hidden');
    this._mostrarChip(this.usuario);
    if (!this._iniciado) { this._iniciado = true; this._aoEntrar(this.usuario); }
  },

  // ---------- bloqueio até verificar o e-mail ----------
  _mostrarTelaVerificacao() {
    ['dbLoading', 'appRoot', 'authScreen'].forEach(id => document.getElementById(id).classList.add('hidden'));
    document.getElementById('verifyScreen').classList.remove('hidden');
    document.getElementById('verifyEmail').textContent = this.usuario.email;
    this._msgVerif('');
    this._pararChecagem();
    this._checagem = setInterval(() => this.verificarAgora(true), 4000); // confere sozinho enquanto a tela estiver aberta
  },
  _pararChecagem() { if (this._checagem) { clearInterval(this._checagem); this._checagem = null; } },
  _msgVerif(texto, tipo) {
    const el = document.getElementById('verifyMsg');
    if (!el) return;
    el.textContent = texto || '';
    el.style.color = tipo === 'ok' ? 'var(--success)' : tipo === 'erro' ? 'var(--danger)' : 'var(--text-light)';
  },
  // silencioso = chamada automática (não mostra "ainda não verificado")
  async verificarAgora(silencioso) {
    if (!this.usuario) return;
    try {
      await this.usuario.reload();
      if (!this.precisaVerificar(this.usuario)) {
        await this.usuario.getIdToken(true); // atualiza o token: as regras do Firestore passam a enxergar email_verified = true
        this._entrarNoApp();
        return;
      }
      if (!silencioso) this._msgVerif('Ainda não identificamos a verificação. Abra o link que enviamos por e-mail (confira o spam) e clique aqui de novo.', 'erro');
    } catch (e) { if (!silencioso) this._msgVerif(this.traduzirErro(e), 'erro'); }
  },

  _esconderTelas() { const a = document.getElementById('authScreen'); if (a) a.classList.add('hidden'); },
  _mostrarTelaLogin() {
    document.getElementById('dbLoading').classList.add('hidden');
    document.getElementById('appRoot').classList.add('hidden');
    document.getElementById('authScreen').classList.remove('hidden');
  },

  _mostrarChip(user) {
    const chip = document.getElementById('userChip');
    if (!chip) return;
    chip.classList.remove('hidden');
    const email = document.getElementById('userEmail');
    const btn = document.getElementById('userSair');
    const verif = document.getElementById('userVerif');
    if (!user) {
      email.textContent = 'Modo local (sem login)';
      btn.classList.add('hidden'); verif.classList.add('hidden');
      const trocar0 = document.getElementById('userTrocarSenha');
      if (trocar0) trocar0.classList.add('hidden');
      return;
    }
    email.textContent = user.displayName ? `${user.displayName} · ${user.email}` : user.email;
    btn.classList.remove('hidden');
    verif.classList.toggle('hidden', !this.precisaVerificar(user));
    const trocar = document.getElementById('userTrocarSenha');
    if (trocar) trocar.classList.toggle('hidden', !(user.providerData || []).some(p => p.providerId === 'password'));
  },

  // ---------- ações ----------
  async entrar(email, senha) { await this._auth.signInWithEmailAndPassword(email, senha); },

  async cadastrar(nome, email, senha) {
    const cred = await this._auth.createUserWithEmailAndPassword(email, senha);
    try { if (nome) await cred.user.updateProfile({ displayName: nome }); } catch (e) { console.warn('[Auth] updateProfile:', e); }
    try { await cred.user.sendEmailVerification(); } catch (e) { console.warn('[Auth] sendEmailVerification:', e); }
  },

  async entrarGoogle() { await this._auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); },

  async recuperarSenha(email) { await this._auth.sendPasswordResetEmail(email); },

  async reenviarVerificacao() {
    if (!this.usuario) return;
    const naTela = !document.getElementById('verifyScreen').classList.contains('hidden');
    try {
      await this.usuario.sendEmailVerification();
      const aviso = 'E-mail de verificação enviado para ' + this.usuario.email + '. Confira também a caixa de spam.';
      if (naTela) { this._msgVerif(aviso, 'ok'); this._cooldownReenvio(30); } else alert(aviso);
    } catch (e) { if (naTela) this._msgVerif(this.traduzirErro(e), 'erro'); else alert(this.traduzirErro(e)); }
  },
  _cooldownReenvio(seg) {
    const b = document.getElementById('verifyReenviar');
    if (!b) return;
    clearInterval(this._cooldown);
    let r = seg; b.disabled = true; b.textContent = `Reenviar e-mail (${r}s)`;
    this._cooldown = setInterval(() => {
      r--;
      if (r <= 0) { clearInterval(this._cooldown); b.disabled = false; b.textContent = 'Reenviar e-mail'; }
      else b.textContent = `Reenviar e-mail (${r}s)`;
    }, 1000);
  },

  // Troca de senha sem digitar a senha atual: enviamos um link de redefinição para o e-mail da própria conta
  async trocarSenha() {
    if (!this.usuario || !this.usuario.email) return;
    if (!confirm(`Enviaremos um link para ${this.usuario.email} para você definir uma nova senha. Continuar?`)) return;
    try { await this.recuperarSenha(this.usuario.email); alert('Link enviado! Confira sua caixa de entrada (e o spam).'); }
    catch (e) { alert(this.traduzirErro(e)); }
  },

  async sair() {
    if (typeof provaIniciada !== 'undefined' && provaIniciada) {
      if (!confirm('Há um simulado em andamento. Sair assim mesmo? O progresso fica salvo e pode ser retomado quando você entrar de novo.')) return;
      try { salvarSessao(); } catch (e) { /* segue */ }
      provaIniciada = false; // evita o aviso de "sair do site" do navegador
    }
    try { await this._auth.signOut(); } finally { location.reload(); } // recarrega para limpar todo o estado em memória
  },

  traduzirErro(e) {
    const mapa = {
      'auth/invalid-email': 'E-mail inválido.',
      'auth/missing-email': 'Informe o e-mail.',
      'auth/missing-password': 'Informe a senha.',
      'auth/user-disabled': 'Esta conta foi desativada.',
      'auth/user-not-found': 'Não existe conta com esse e-mail.',
      'auth/wrong-password': 'Senha incorreta.',
      'auth/invalid-credential': 'E-mail ou senha incorretos.',
      'auth/invalid-login-credentials': 'E-mail ou senha incorretos.',
      'auth/email-already-in-use': 'Já existe uma conta com esse e-mail. Use "Entrar" ou recupere a senha.',
      'auth/weak-password': 'Senha fraca: use pelo menos 6 caracteres.',
      'auth/too-many-requests': 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.',
      'auth/network-request-failed': 'Falha de conexão. Verifique sua internet.',
      'auth/popup-closed-by-user': 'A janela do Google foi fechada antes de concluir.',
      'auth/cancelled-popup-request': 'Login com Google cancelado.',
      'auth/popup-blocked': 'O navegador bloqueou a janela do Google. Libere pop-ups para este site.',
      'auth/operation-not-allowed': 'Esse método de login não está ativado no Firebase (Authentication → Sign-in method).',
      'auth/unauthorized-domain': 'Este domínio não está autorizado no Firebase (Authentication → Settings → Authorized domains).',
      'auth/operation-not-supported-in-this-environment': 'O login precisa de http:// ou https://. Abra o app por um servidor local ou pelo site publicado (não por arquivo).',
      'auth/admin-restricted-operation': 'Novos cadastros estão desativados neste projeto.',
      'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'A apiKey do firebase-config.js é inválida.',
      'auth/invalid-api-key': 'A apiKey do firebase-config.js é inválida.',
      'auth/configuration-not-found': 'O Authentication ainda não foi ativado no projeto Firebase (clique em "Começar" em Authentication).'
    };
    return mapa[e && e.code] || ('Erro: ' + ((e && e.message) || e));
  },

  // ---------- interface da tela de login ----------
  msg(texto, tipo) {
    const el = document.getElementById('authMsg');
    if (!el) return;
    el.textContent = texto || '';
    el.style.color = tipo === 'ok' ? 'var(--success)' : tipo === 'erro' ? 'var(--danger)' : 'var(--text-light)';
  },
  aba(modo) {
    this._modo = modo;
    const cad = modo === 'cadastrar';
    document.getElementById('authTabEntrar').classList.toggle('active', !cad);
    document.getElementById('authTabCadastrar').classList.toggle('active', cad);
    document.getElementById('authCampoNome').classList.toggle('hidden', !cad);
    document.getElementById('authCampoConfirma').classList.toggle('hidden', !cad);
    document.getElementById('authEsqueci').classList.toggle('hidden', cad);
    document.getElementById('authBtn').textContent = cad ? 'Criar conta' : 'Entrar';
    document.getElementById('authSenha').autocomplete = cad ? 'new-password' : 'current-password';
    this.msg('');
  },
  _ocupado(ocupado) {
    ['authBtn', 'authGoogleBtn'].forEach(id => { const b = document.getElementById(id); if (b) b.disabled = ocupado; });
  },
  async enviar(ev) {
    if (ev) ev.preventDefault();
    const email = document.getElementById('authEmail').value.trim();
    const senha = document.getElementById('authSenha').value;
    this.msg('');
    if (this._modo === 'cadastrar') {
      const nome = document.getElementById('authNome').value.trim();
      if (senha.length < 6) return this.msg('A senha precisa ter pelo menos 6 caracteres.', 'erro');
      if (senha !== document.getElementById('authSenha2').value) return this.msg('As senhas não conferem.', 'erro');
      this._ocupado(true); this.msg('Criando conta...');
      try { await this.cadastrar(nome, email, senha); }
      catch (e) { this.msg(this.traduzirErro(e), 'erro'); this._ocupado(false); }
    } else {
      this._ocupado(true); this.msg('Entrando...');
      try { await this.entrar(email, senha); }
      catch (e) { this.msg(this.traduzirErro(e), 'erro'); this._ocupado(false); }
    }
  },
  async google() {
    this._ocupado(true); this.msg('Abrindo o login do Google...');
    try { await this.entrarGoogle(); }
    catch (e) { this.msg(this.traduzirErro(e), 'erro'); this._ocupado(false); }
  },
  async esqueci() {
    const email = document.getElementById('authEmail').value.trim();
    if (!email) return this.msg('Digite seu e-mail no campo acima e clique de novo em "Esqueci minha senha".', 'erro');
    try { await this.recuperarSenha(email); this.msg('Se existir uma conta com esse e-mail, enviamos um link para redefinir a senha. Confira também o spam.', 'ok'); }
    catch (e) { this.msg(this.traduzirErro(e), 'erro'); }
  }
};

// atalhos usados pelos atributos onclick/onsubmit do HTML
function authAba(m) { Auth.aba(m); }
function authEnviar(ev) { return Auth.enviar(ev); }
function authGoogle() { return Auth.google(); }
function authEsqueci() { return Auth.esqueci(); }
