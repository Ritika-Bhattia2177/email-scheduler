import { Router } from 'express'
import {
  createSenderController,
  deleteSenderController,
  getSenderController,
  listSendersController,
  updateSenderController,
} from '../controllers/senders.controller'

const sendersRouter = Router()

sendersRouter.get('/', listSendersController)
sendersRouter.get('/:id', getSenderController)
sendersRouter.post('/', createSenderController)
sendersRouter.put('/:id', updateSenderController)
sendersRouter.delete('/:id', deleteSenderController)

export default sendersRouter
