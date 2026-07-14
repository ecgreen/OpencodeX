import type { QuestionRequest } from "@opencode-ai/sdk/v2"
import { createQuestionController } from "./question-controller"
import { QuestionPromptView } from "./question-view"

export function QuestionPrompt(props: { request: QuestionRequest }) {
  return <QuestionPromptView controller={createQuestionController(props)} />
}
