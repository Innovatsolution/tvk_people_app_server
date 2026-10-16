import { asyncHandler } from '../utils/asyncHandler.js'
import { createComplaintChatbot } from '../services/complaintChatbot.service.js'
import { askOllamaForFilter } from '../services/ollama.service.js'
import { searchComplaints } from '../repositories/complaint.repository.js'
import { findUsersByIds } from '../repositories/user.repository.js'

const chatbot = createComplaintChatbot({
  askLlmForFilter: askOllamaForFilter,
  searchComplaints,
  findUsersByIds,
})

// POST /api/admin/chatbot/query   { message }
// -> { reply, filter, total, summary, complaints, truncated }
export const askChatbot = asyncHandler(async (req, res) => {
  res.json(await chatbot.answer(req.body.message))
})
