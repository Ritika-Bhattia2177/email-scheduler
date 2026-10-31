import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import morgan from 'morgan'
import { errorHandler } from './middleware/errorHandler'
import { notFoundHandler } from './middleware/notFound'
import { bullBoardBasePath, bullBoardRouter } from './config/bullBoard'
import authRouter from './routes/auth.routes'
import emailsRouter from './routes/emails.routes'
import healthRouter from './routes/health.routes'
import sendersRouter from './routes/senders.routes'
import slackRouter from './routes/slack.routes'
import { env } from './config/env'

const app = express()

app.set('trust proxy', 1)

const allowedOrigins = new Set(env.CORS_ALLOWED_ORIGINS)

app.disable('x-powered-by')
app.use(helmet())
app.use(cors({
  origin: (origin, callback) => callback(null, origin === undefined || allowedOrigins.has(origin)),
  credentials: true,
}))
app.use(express.json({ limit: '1mb' }))
app.use(morgan((tokens, request, response) => {
  const path = (tokens.url(request, response) ?? '/').split('?')[0]
  return [tokens.method(request, response), path, tokens.status(request, response), `${tokens['response-time'](request, response)} ms`]
    .filter(Boolean)
    .join(' ')
}))

app.use('/api', healthRouter)
app.use('/api/auth', authRouter)
app.use('/api/emails', emailsRouter)
app.use('/api/senders', sendersRouter)
app.use('/api/slack', slackRouter)
if (env.BULL_BOARD_ENABLED) app.use(bullBoardBasePath, bullBoardRouter)
app.use('/api', notFoundHandler)
app.use(errorHandler)

export default app
