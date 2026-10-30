import type { RequestHandler } from 'express'

export const getHealth: RequestHandler = (_request, response) => {
  response.status(200).json({
    success: true,
    message: 'ReachInbox backend is running',
  })
}
