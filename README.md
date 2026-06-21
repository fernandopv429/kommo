# Kommo Integrations

Gerenciador OAuth 2.0 Kommo (Multi-tenant)

## Sobre

Este projeto é de autoria e propriedade exclusiva de **Fernando B. Nascimento**.

Desenvolvido para gerenciar integrações e criar credenciais e uso com as plataformas.

## Autoria

- **Autor**: Fernando B. Nascimento
- **Propriedade**: Todos os direitos reservados.

## Deploy no Coolify

Este projeto está pronto para ser hospedado via [Coolify](https://coolify.io/) utilizando seu `Dockerfile` padrão. 

1. No painel do seu Coolify, adicione um novo recurso escolhendo hospedar a partir do Git (Nixpacks/Dockerfile).
2. Conecte ao seu repositório que contém os arquivos deste projeto.
3. O Coolify deve identificar automaticamente o `Dockerfile` na raiz do projeto.
4. Na aba **Environment Variables** (Variáveis de Ambiente), você deve preencher os valores essenciais de acordo com o `.env.example`:
   - `OPENAI_API_KEY`: Sua chave de administração da conta OpenAI.
   - `APP_URL`: URL base em que a sua aplicação ficará disponível (ex: `https://kommo.seusite.com`).
   - `DATABASE_URL`: URL de conexão do PostgreSQL (você pode criar um banco nativo no próprio Coolify).
   - `KOMMO_CLIENT_ID`: ID do cliente (Client ID) de integração no Kommo.
   - `KOMMO_CLIENT_SECRET`: Segredo (Client Secret) da integração no Kommo.
   - `KOMMO_REDIRECT_URI`: A URI de redirecionamento do Kommo (normalmente `SuaAPP_URL/auth/kommo/callback`).
   - `EVOLUTION_API_KEY`: Chave de API de integração com o Evolution API.
   - `EVOLUTION_URL`: URL base da instância do Evolution API.
   - `REDIS_URL`: URL de conexão com o banco Redis (usado para o Buffer/Fila do BullMQ).
5. Defina a porta exposta como `3000` caso seja solicitado.
6. **Configuração de Build e Inicialização (IMPORTANTE)**: No Coolify você pode escolher duas formas de fazer o deploy, **Nixpacks** (Padrão) ou **Docker**:
   - **Se usar Nixpacks**: 
     - **Build Command**: `npm install && npx prisma generate && npm run build`
     - **Start Command**: `npx prisma db push && npm start` *(Esse comando iniciará a base de dados primeiro e depois o servidor nas portas adequadas)*
   - **Se usar Docker**:
     - O sistema já possui um `Dockerfile` otimizado (Multi-stage).
     - Você pode deixar os campos *Build Command* e *Start Command* vazios.
     - No campo **Docker Build Stage Target**, você pode deixar **vazio** (ele pegará o último estágio automaticamente) ou preencher com `runner`.
7. **Variáveis de URL e Fila (Fundamental)**: 
   - Se certifique de configurar a `APP_URL` com a URL pública final que o Coolify gerar para o seu app.
   - É **Obrigatório** ter um banco Redis rodando (você pode provisionar um com um clique no Coolify) e apontar a variável de ambiente `REDIS_URL`. Isso é essencial pois as mensagens do WhatsApp entram numa fila antes de irem pro seu webhook centralizador.
8. Clique em **Deploy**! A plataforma iniciará o processo de instalação e fará o servidor entrar online com sucesso.
9. **Após o App estar no ar**: Entre no sistema e clique no botão **Sincronizar Webhook** na listagem de conexões. Isso dirá à Evolution que a URL do seu sistema agora é a URL do Coolify.

## Como o Sistema Funciona

Este sistema atua como um hub central (Middleware e Gerenciador) para simplificar a autenticação, roteamento e consumo de recursos de Inteligência Artificial para múltiplos inquilinos (Multi-tenant).

### 1. Autenticação e Webhooks (Kommo e Evolution)
O sistema recebe a autenticação via OAuth 2.0 padrão da Kommo (criando as credenciais e acessos temporários de cada CRM conectado). Ele também gerencia Webhooks que vêm da **Evolution API**, fazendo uma ponte transparente onde todas as mensagens e eventos de clientes chegam primeiramente nesta plataforma, podendo ser interceptados, pré-analisados ou passados para fluxos no N8N.

### 2. Buffer de Mensagens e Debounce (BullMQ + Redis)
Para evitar race conditions e timeouts causados pelo envio rápido de várias mensagens seguidas (ex: "Oi", "Tudo bem?", "Qual valor?"), o sistema utiliza o **BullMQ** juntamente com o **Redis**:

- Toda mensagem recebida no Webhook cai num *Buffer* do Redis `buffer:${tenantId}:${userPhone}`.
- O Webhook responde instantaneamente (`res.status(200)`).
- Um *Debounce Delay* de 8 segundos é iniciado antes do Job ser enfileirado para o processamento.
- O **Worker** agrupa todas as mensagems recebidas naquela janela de tempo e realiza todo fluxo pesado (consulta Kommo, roteamento inteligente da IA e repasse para o n8n). Em caso de falha de conexão, ele automaticamente faz retentativas exponenciais.

### 3. OpenAI SDK Dinâmico e Multi-Tenant
Para garantir a segurança dos dados e um controle de gastos efetivo, o sistema não utiliza uma única chave da OpenAI para todos. Em vez disso, ele utiliza os recursos de **Gerenciamento de Projetos e Service Accounts da OpenAI**:

- **Chave Master (`OPENAI_API_KEY`)**: Definida no `.env`, ela só é utilizada pelas rotas administrativas para interagir com a API de administração da OpenAI.
- **Isolamento por Tenant**: Quando você aprova a criação de projeto para uma conexão (tenant), ele consulta a OpenAI, gera um `Project` e uma respectiva `Service Account`. Assim, ele obtém uma chave de API (`apiKey`) completamente **isolada e exclusiva** do novo projeto.
- **Armazenamento no Banco de Dados**: A nova chave `apiKey` de cada projeto é armazenada de forma segura na tabela `OpenAiProject` (PostgreSQL), vinculada à ID da conexão/empresa.
- **Uso da IA e Token Counting**: Posteriormente, toda ação realizada (seja chat, requisições de transcrição ou contagem de tokens com `Responses API`) utiliza diretamente a chave atrelada ao tenant, instanciando o SDK de forma dinâmica: `const client = new OpenAI({ apiKey: tenantApiKey });`. As credenciais dinâmicas ficam armazenadas no banco de dados.
- **Custo Preciso**: Com as chaves e projetos isolados, o painel do sistema consulta os custos e tokens gastos diretamente na API de administração da OpenAI usando a Chave Master, mas filtrando pelo projeto específico. Para medir os tokens antes de os enviar e gerar estimativas exatas de custos, o sistema faz uso da função `.responses.input_tokens.count` do SDK da OpenAI.
