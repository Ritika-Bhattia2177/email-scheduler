import { Client } from '@elastic/elasticsearch'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { env } from './env'

const caCertificatePath = resolve(__dirname, '../../', env.ELASTICSEARCH_CA_CERT_PATH)
let caCertificate: Buffer
try {
  caCertificate = readFileSync(caCertificatePath)
} catch {
  throw new Error('Elasticsearch CA certificate could not be read; check ELASTICSEARCH_CA_CERT_PATH relative to the backend project directory')
}

const auth = env.ELASTICSEARCH_API_KEY
  ? { apiKey: env.ELASTICSEARCH_API_KEY }
  : env.ELASTICSEARCH_USERNAME && env.ELASTICSEARCH_PASSWORD
    ? {
        username: env.ELASTICSEARCH_USERNAME,
        password: env.ELASTICSEARCH_PASSWORD,
      }
    : undefined

export const elasticsearchClient = new Client({
  node: env.ELASTICSEARCH_NODE,
  tls: { ca: caCertificate },
  requestTimeout: 10_000,
  maxRetries: 0,
  ...(auth ? { auth } : {}),
})
