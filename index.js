const cron = require('node-cron');
const { spawn } = require('child_process');
const AWS = require('aws-sdk');
const archiver = require('archiver');
const fs = require('fs');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
require('dotenv').config();

const {
  PGHOST,
  PGUSER,
  PGDATABASE,
  PGPASSWORD,
  PGPORT,
  CRON_SCHEDULE,
  RUN_ON_DEPLOY,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  AWS_REGION,
  AWS_S3_BUCKET
} = process.env;

// Configura o AWS SDK
const client = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
});

const uploadFileToS3 = async (params) => {
  const upload = new Upload({
    client: client,
    params: params,
  });
  return await upload.done();
};


const s3 = new AWS.S3();

const runBackup = async () => {
  const date = new Date().toISOString().slice(0, 10);
  const backupFileName = `backup-${PGDATABASE}-${date}.sql`;
  const archiveFileName = `${backupFileName}.zip`;
  const backupFilePath = `./${backupFileName}`;
  const archiveFilePath = `./${archiveFileName}`;

  console.log(`Iniciando backup para o banco de dados ${PGDATABASE}...`);

  // 1. Executa o pg_dump e salva o backup em um arquivo
  return new Promise((resolve, reject) => {
    // Definimos a variável de ambiente para o comando pg_dump, garantindo segurança
    const dumpProcess = spawn('pg_dump', [
      '-h', PGHOST,
      '-p', PGPORT,
      '-U', PGUSER,
      '-d', PGDATABASE,
      '-F', 'p', // Formato "plain text"
      '-f', backupFilePath
    ], {
      env: { PGPASSWORD }
    });

    dumpProcess.on('close', (code) => {
      if (code === 0) {
        console.log(`Backup do PostgreSQL concluído e salvo em ${backupFilePath}`);
        resolve();
      } else {
        reject(new Error(`pg_dump falhou com o código ${code}`));
      }
    });
  })
  .then(() => {
    console.log('Compactando o arquivo de backup...');
    // 2. Compacta o arquivo de backup
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(archiveFilePath);
      const archive = archiver('zip', {
        zlib: { level: 9 } // Nível de compressão
      });

      output.on('close', () => {
        console.log(`Arquivo compactado: ${archive.pointer()} bytes.`);
        resolve();
      });

      archive.on('error', (err) => reject(err));

      archive.pipe(output);
      archive.file(backupFilePath, { name: backupFileName });
      archive.finalize();
    });
  })
  .then(() => {
    console.log('Iniciando upload para o S3...');
    // 3. Faz o upload para o S3
    const fileContent = fs.readFileSync(archiveFilePath);
    const params = {
      Bucket: AWS_S3_BUCKET,
      Key: `backups/${archiveFileName}`,
      Body: fileContent
    };

    return uploadFileToS3(params);
  })
  .then((data) => {
    console.log(`Upload para o S3 concluído. Localização: ${data.Location}`);
  })
  .catch((err) => {
    console.error('Erro no processo de backup:', err);
  })
  .finally(() => {
    // 4. Limpa os arquivos temporários localmente
    console.log('Limpando arquivos temporários...');
    if (fs.existsSync(backupFilePath)) {
      fs.unlinkSync(backupFilePath);
    }
    if (fs.existsSync(archiveFilePath)) {
      fs.unlinkSync(archiveFilePath);
    }
  });
};

// Executa o backup imediatamente se RUN_ON_DEPLOY for 'true'
if (RUN_ON_DEPLOY === 'true') {
  console.log('Executando backup inicial após o deploy...');
  runBackup();
}

// Agenda a tarefa diária
cron.schedule(CRON_SCHEDULE, () => {
  console.log('Tarefa agendada: Executando backup diário.');
  runBackup();
}, {
  scheduled: true,
  timezone: 'America/Sao_Paulo'
});

console.log(`Tarefa de backup agendada para o cron: '${CRON_SCHEDULE}'`);
