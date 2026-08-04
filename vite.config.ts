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
      whoopApi(env.WHOOP_CLIENT_SECRET),
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

function whoopApi(clientSecret?: string): Plugin {
  return {
    name: 'nutrition-whoop-api',
    configureServer(server) {
      server.middlewares.use('/api/whoop/token', async (request, response) => {
        if (request.method !== 'POST') {
          response.statusCode = 405
          response.setHeader('Allow', 'POST')
          response.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        if (!clientSecret) {
          response.statusCode = 500
          response.setHeader('Content-Type', 'application/json')
          response.end(JSON.stringify({ error: 'WHOOP_CLIENT_SECRET is not configured.' }))
          return
        }

        try {
          const raw = await readRequestBody(request)
          const payload = JSON.parse(raw.toString('utf8')) as Record<string, string>
          const upstream = await fetch('https://api.prod.whoop.com/oauth/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ ...payload, client_secret: clientSecret }),
          })
          const text = await upstream.text()
          response.statusCode = upstream.status
          response.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
          response.end(text)
        } catch (error) {
          response.statusCode = 500
          response.setHeader('Content-Type', 'application/json')
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'WHOOP token request failed.' }))
        }
      })

      server.middlewares.use('/api/whoop/summary', async (request, response) => {
        if (request.method !== 'GET') {
          response.statusCode = 405
          response.setHeader('Allow', 'GET')
          response.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        try {
          const authorization = request.headers.authorization
          if (!authorization) {
            response.statusCode = 401
            response.setHeader('Content-Type', 'application/json')
            response.end(JSON.stringify({ error: 'Missing WHOOP access token.' }))
            return
          }
          const summary = await readWhoopSummary(authorization)
          response.statusCode = 200
          response.setHeader('Content-Type', 'application/json')
          response.end(JSON.stringify(summary))
        } catch (error) {
          response.statusCode = 500
          response.setHeader('Content-Type', 'application/json')
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'WHOOP summary request failed.' }))
        }
      })
    },
  }
}

async function readWhoopSummary(authorization: string) {
  const end = new Date()
  const start = new Date(end.getTime() - 36 * 60 * 60 * 1000)
  const params = new URLSearchParams({ limit: '10', start: start.toISOString(), end: end.toISOString() })
  const headers = { Authorization: authorization }
  const [profile, cycle, recovery, sleep, workout] = await Promise.all([
    whoopGet('/developer/v2/user/profile/basic', headers),
    whoopGet(`/developer/v2/cycle?${params}`, headers),
    whoopGet(`/developer/v2/recovery?${params}`, headers),
    whoopGet(`/developer/v2/activity/sleep?${params}`, headers),
    whoopGet(`/developer/v2/activity/workout?${params}`, headers),
  ])

  const cycleRecord = firstRecord(cycle)
  const recoveryRecord = firstRecord(recovery)
  const sleepRecord = firstRecord(sleep)
  const workouts = Array.isArray(workout?.records) ? workout.records : []

  return {
    profile: profile
      ? {
          firstName: profile.first_name,
          lastName: profile.last_name,
          email: profile.email,
        }
      : null,
    cycle: cycleRecord
      ? {
          strain: cycleRecord.score?.strain ?? null,
          kilojoule: cycleRecord.score?.kilojoule ?? null,
          averageHeartRate: cycleRecord.score?.average_heart_rate ?? null,
          maxHeartRate: cycleRecord.score?.max_heart_rate ?? null,
        }
      : null,
    recovery: recoveryRecord
      ? {
          score: recoveryRecord.score?.recovery_score ?? null,
          hrvRmssdMilli: recoveryRecord.score?.hrv_rmssd_milli ?? null,
          restingHeartRate: recoveryRecord.score?.resting_heart_rate ?? null,
          spo2Percentage: recoveryRecord.score?.spo2_percentage ?? null,
        }
      : null,
    sleep: sleepRecord
      ? {
          performancePercentage: sleepRecord.score?.sleep_performance_percentage ?? null,
          efficiencyPercentage: sleepRecord.score?.sleep_efficiency_percentage ?? null,
          consistencyPercentage: sleepRecord.score?.sleep_consistency_percentage ?? null,
          totalSleepHours: millisToHours(
            (sleepRecord.score?.stage_summary?.total_light_sleep_time_milli ?? 0) +
              (sleepRecord.score?.stage_summary?.total_slow_wave_sleep_time_milli ?? 0) +
              (sleepRecord.score?.stage_summary?.total_rem_sleep_time_milli ?? 0),
          ),
        }
      : null,
    workouts: workouts.map((record: any) => ({
      sportName: record.sport_name ?? record.sport_id ?? null,
      strain: record.score?.strain ?? null,
      kilojoule: record.score?.kilojoule ?? null,
      averageHeartRate: record.score?.average_heart_rate ?? null,
    })),
  }
}

async function whoopGet(pathname: string, headers: { Authorization: string }): Promise<any> {
  const response = await fetch(`https://api.prod.whoop.com${pathname}`, { headers })
  if (response.status === 404) return null
  const data: any = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(data?.error_description || data?.error || `WHOOP request failed: ${response.status}`)
  }
  return data
}

function firstRecord(value: any) {
  return Array.isArray(value?.records) ? value.records[0] : value
}

function millisToHours(value: number) {
  return Math.round((value / 1000 / 60 / 60) * 10) / 10
}

function readRequestBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}
