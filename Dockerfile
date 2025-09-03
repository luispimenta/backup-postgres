# Usa uma imagem base do Node.js
FROM node:18-alpine

# Define o diretório de trabalho na imagem
WORKDIR /usr/src/app

# Copia os arquivos package.json e package-lock.json
COPY package*.json ./

# Instala as dependências do Node.js
RUN npm install

# Copia o resto da aplicação
COPY . .

# Instala o cliente do PostgreSQL para ter o pg_dump disponível
# A dependência do pg_dump é essencial para o script funcionar
RUN apk add --no-cache postgresql-client

# Expõe a porta que a aplicação escuta (se aplicável, embora este não seja um servidor web)
EXPOSE 3000

# Comando para rodar a aplicação quando o contêiner iniciar
CMD [ "npm", "start" ]
