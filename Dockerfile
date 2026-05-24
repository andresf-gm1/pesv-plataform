# Usamos una imagen ligera de Node.js
FROM node:20-slim

# Instalamos dependencias necesarias para Prisma y herramientas de red
RUN apt-get update && apt-get install -y openssl libssl-dev && rm -rf /var/lib/apt/lists/*

# Directorio de trabajo
WORKDIR /app

# Copiamos los archivos de dependencias
COPY package*.json ./

# Instalamos las dependencias de Node
RUN npm install

# Copiamos el schema Prisma para generar el cliente
COPY schema.prisma ./schema.prisma

# Generamos el cliente de Prisma
RUN npx prisma generate

# Copiamos el resto de la aplicación
COPY . .

EXPOSE 3000

# Ejecutamos las migraciones y luego iniciamos el servidor
CMD npx prisma db push && npm start
