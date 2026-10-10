import { loadEnvFile } from 'node:process';

// Railway supplies environment variables directly; a local .env is optional.
try {
  loadEnvFile('.env');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
