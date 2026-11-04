/* ============================================================
   firebase-config.js — configuração do seu projeto Firebase.
   Cole aqui o objeto "firebaseConfig" do Console do Firebase:
   Configurações do projeto (engrenagem) → Geral → Seus apps → App da Web.

   Essas chaves NÃO são segredo (são feitas para ficar no navegador).
   A proteção vem dos "Domínios autorizados" do Firebase Authentication.

   Enquanto este arquivo estiver com "COLE_AQUI", o app roda em
   MODO LOCAL (sem login), como antes.
   ============================================================ */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDM3C5EchTnhB5IIT5UEq50paWBZMaBrP0",
  authDomain: "meu-simulados.firebaseapp.com",
  projectId: "meu-simulados",
  storageBucket: "meu-simulados.firebasestorage.app",
  messagingSenderId: "438878469642",
  appId: "1:438878469642:web:cd5bf31b6fbd690339a9f3",
  measurementId: "G-9DXMPEDV7S"
};

/* ============================================================
   Opções de acesso (edite conforme o seu uso)
   ============================================================ */
window.APP_OPCOES = {
  // true  = qualquer pessoa com o link cria conta (aba "Criar conta").
  // false = SÓ POR CONVITE: esconde "Criar conta" e o botão Google; você cadastra
  //         cada usuário em Console Firebase → Authentication → Users → Adicionar usuário.
  //         (Para o Firebase também recusar cadastros feitos por fora do app, desative
  //          a criação de contas em Authentication → Settings → User actions.)
  cadastroAberto: true,

  loginGoogle: true,            // mostra o botão "Continuar com Google" (ignorado se cadastroAberto = false)
  exigirEmailVerificado: true,  // bloqueia o app até o usuário (e-mail/senha) confirmar o e-mail
  exigirChaveIA: true           // exige ao menos um provedor de IA configurado antes de liberar as telas
};
