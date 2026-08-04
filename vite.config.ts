import fs from 'node:fs'
import type { IncomingMessage } from 'node:http'
import path from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const certDir = path.resolve(__dirname, '.cert')
const localHttps =
  process.env.NUTRI_HTTPS === '1' &&
  fs.existsSync(path.join(certDir, 'local-key.pem')) &&
  fs.existsSync(path.join(certDir, 'local-cert.pem'))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const openAiKey = env.OPENAI_API_KEY || env.VITE_OPENAI_API_KEY

  return {
    server: {
      host: true,
      https: localHttps
        ? {
            key: fs.readFileSync(path.join(certDir, 'local-key.pem')),
            cert: fs.readFileSync(path.join(certDir, 'local-cert.pem')),
          }
        : undefined,
    },
    plugins: [
      transcribeApi(openAiKey),
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg'],
        manifest: {
          name: 'Nutrition Copilot',
          short_name: 'Nutrition',
          description: 'A conversational nutrition tracker',
          theme_color: '#16a34a',
          background_color: '#ffffff',
          display: 'standalone',
          start_url: '/',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        },
      }),
    ],
  }
})

function transcribeApi(apiKey?: string): Plugin {
  return {
    name: 'nutrition-transcribe-api',
    configureServer(server) {
      server.middlewares.use('/api/transcribe', async (request, response) => {
        if (request.method !== 'POST') {
          response.statusCode = 405
          response.setHeader('Allow', 'POST')
          response.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        if (!apiKey) {
          response.statusCode = 500
          response.setHeader('Content-Type', 'application/json')
          response.end(JSON.stringify({ error: 'OPENAI_API_KEY is not configured.' }))
          return
        }

        try {
          const body = await readRequestBody(request)
          const upstream = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': request.headers['content-type'] || 'multipart/form-data',
            },
            body,
          })
          const text = await upstream.text()
          response.statusCode = upstream.status
          response.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
          response.end(text)
        } catch (error) {
          response.statusCode = 500
          response.setHeader('Content-Type', 'application/json')
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Audio transcription failed.' }))
        }
      })
    },
  }
}

function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}
