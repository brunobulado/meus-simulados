# Meus Simulados

Plataforma de estudos para concursos e ENEM: gera simulados com IA (você usa as suas próprias chaves),
corrige no padrão de cada banca, guarda tudo em SQLite no navegador e faz backup opcional na nuvem.

Site estático (HTML + CSS + JS), sem build.

## Rodar no computador
Na pasta do projeto:

    python -m http.server 8000

Abra http://localhost:8000. Sem configurar o Firebase, o app roda em "modo local" (sem login).

## Arquivos
- `index.html`, `style.css` — interface
- `app.js` — simulados, dashboard, ENEM e redação
- `db.js` — banco SQLite (sql.js) salvo no IndexedDB, um por conta
- `auth.js` — login, cadastro, verificação de e-mail
- `nuvem.js` — backup no Firestore
- `firebase-config.js` — configuração do Firebase e opções de acesso
- `firestore.rules` — regras de segurança do Firestore (publicar no console)
- `netlify.toml` — publicação no Netlify

## Configurar o Firebase
1. Crie um projeto em https://console.firebase.google.com e registre um app Web.
2. Cole o `firebaseConfig` em `firebase-config.js`.
3. Authentication → Sign-in method: ative E-mail/senha (e Google, se quiser).
4. Authentication → Settings → Authorized domains: adicione o domínio do seu site.
5. Firestore Database → Criar banco de dados → aba Regras → cole `firestore.rules` → Publicar.

## Segurança
- As chaves de IA ficam apenas no navegador de cada usuário. Nunca coloque chaves de IA em arquivos do projeto.
- O `firebaseConfig` não é segredo; a proteção vem dos domínios autorizados e das regras do Firestore.
