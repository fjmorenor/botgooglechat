   # Usamos Node 20 slim
    FROM node:20-slim

    # Crear directorio de la app
    WORKDIR /app

    # Copiar package.json y package-lock.json
    # ¡IMPORTANTE! Asegúrate de que esta línea esté presente y correcta
    COPY package*.json ./

    # Instalar dependencias de producción
    # Esta línea instala lo que está definido en package.json y package-lock.json
    RUN npm install --production --ignore-scripts

    # Copiar el resto de la app (incluyendo index.js y el .json de la cuenta de servicio si no usas Secret Manager)
    COPY . .

    # Puerto que usará Cloud Run
    ENV PORT=8080

    # Comando para ejecutar la app
    CMD ["node", "index.js"]