const { createBackendServer, startServices } = require('./service-manager');

async function main() {
  const backend = await createBackendServer();
  console.log(`PR model proxy is running at http://127.0.0.1:${backend.port}/v1`);
  await startServices();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
