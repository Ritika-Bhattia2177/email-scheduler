export interface Sender {
  id: string
  name: string
  email: string
}

export const mockSenders: Sender[] = [
  { id: 'sender-1', name: 'Oliver Brown', email: 'oliver.brown@domain.io' },
  { id: 'sender-2', name: 'John Smith', email: 'john.smith@domain.io' },
  { id: 'sender-3', name: 'Emma Wilson', email: 'emma.wilson@domain.io' },
]
