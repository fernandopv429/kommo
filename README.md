# Kommo Integrations

Gerenciador OAuth 2.0 Kommo (Multi-tenant)

## Sobre

Este projeto é de autoria e propriedade exclusiva de **Fernando Nascimento Batista**.

Desenvolvido para gerenciar integrações e criar credenciais e uso com as plataformas.

## Autoria

- **Autor**: Fernando Nascimento Batista
- **Propriedade**: Todos os direitos reservados.

## Deploy no Coolify

Este projeto está pronto para ser hospedado via [Coolify](https://coolify.io/) utilizando seu `Dockerfile` padrão. 

1. No painel do seu Coolify, adicione um novo recurso escolhendo hospedar a partir do Git (Nixpacks/Dockerfile).
2. Conecte ao seu repositório que contém os arquivos deste projeto.
3. O Coolify deve identificar automaticamente o `Dockerfile` na raiz do projeto.
4. Na aba **Environment Variables** (Variáveis de Ambiente), você deve preencher os valores essenciais de acordo com o `.env.example`, por exemplo:
   - `OPENAI_API_KEY`: Sua chave de administração da conta OpenAI.
   - `APP_URL`: URL na qual a sua aplicação ficará disponível (ex: `https://kommo.seusite.com`).
   - `DATABASE_URL`: Endereço do seu banco PostgreSQL (pode ser o banco nativo criado no próprio Coolify).
   - Quaisquer outras credenciais necessárias (Kommo, etc).
5. Defina a porta exposta como `3000` caso seja solicitado.
6. Clique em **Deploy**! O Coolify irá construir a imagem Docker e colocar a aplicação no ar de forma automática.
