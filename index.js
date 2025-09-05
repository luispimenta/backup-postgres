const cron = require('node-cron');
const { spawn } = require('child_process');
const archiver = require('archiver');
const fs = require('fs');
const { S3Client } = require('@aws-sdk/client-s3');
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

// Configura o AWS SDK v3
const client = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
});

const runBackup = async () => {
  const date = new Date().toISOString().slice(0, 10);
  const backupFileName = `backup-${PGDATABASE}-${date}.sql`;
  const archiveFileName = `${backupFileName}.zip`;

  console.log(`Iniciando backup para o banco de dados ${PGDATABASE}...`);

  // Use um stream para o output do pg_dump
  const dumpProcess = spawn('pg_dump', [
    '-h', PGHOST,
    '-p', PGPORT,
    '-U', PGUSER,
    '-d', PGDATABASE,
    '-F', 'p', // Formato "plain text"
  ], {
    env: { PGPASSWORD }
  });

  const archive = archiver('zip', {
    zlib: { level: 9 } // Nível de compressão
  });

  // O archiver recebe o stream do pg_dump
  archive.append(dumpProcess.stdout, { name: backupFileName });

  // 1. Faz o upload para o S3 diretamente do stream do archiver
  const params = {
    Bucket: AWS_S3_BUCKET,
    Key: `backups/${archiveFileName}`,
    Body: archive, // Passamos o stream do archiver para o S3
  };

  try {
    console.log('Iniciando upload para o S3...');
    const upload = new Upload({
      client: client,
      params: params,
    });

    const data = await upload.done();
    console.log(`Upload para o S3 concluído.`);
    console.log(data);

    archive.finalize(); // Finaliza o archiver após o upload
  } catch (err) {
    console.error('Erro no processo de backup:', err);
    archive.destroy(); // Limpa o archiver em caso de erro
    throw err;
  }
};

// Executa o backup imediatamente se RUN_ON_DEPLOY for 'true'
if (RUN_ON_DEPLOY === 'true') {
  console.log('Executando backup inicial após o deploy...');
  runBackup().catch(() => {}); // Adiciona um catch para evitar crash
}

// Agenda a tarefa diária
cron.schedule(CRON_SCHEDULE, () => {
  console.log('Tarefa agendada: Executando backup diário.');
  runBackup().catch(() => {}); // Adiciona um catch para evitar crash
}, {
  scheduled: true,
  timezone: 'America/Sao_Paulo'
});

console.log(`Tarefa de backup agendada para o cron: '${CRON_SCHEDULE}'`);
