import { ChatOpenAI as LangchainChatOpenAI, ChatOpenAIFields } from '@langchain/openai'
import { IMultiModalOption, IVisionChatModal } from '../../../src'
import { BaseMessage, SystemMessage, HumanMessage, AIMessage } from '@langchain/core/messages'
import { ChatResult } from '@langchain/core/outputs'

const isOpenRouterDebugEnabled = (): boolean => process.env.DEBUG === 'true' || process.env.OPENROUTER_DEBUG === 'true'

export class ChatOpenRouter extends LangchainChatOpenAI implements IVisionChatModal {
    configuredModel: string
    configuredMaxToken?: number
    multiModalOption: IMultiModalOption
    id: string
    enablePromptCaching: boolean

    constructor(id: string, fields?: ChatOpenAIFields & { enablePromptCaching?: boolean }) {
        super(fields)
        this.id = id
        this.configuredModel = fields?.modelName ?? ''
        this.configuredMaxToken = fields?.maxTokens
        this.enablePromptCaching = fields?.enablePromptCaching ?? true
    }

    setMultiModalOption(multiModalOption: IMultiModalOption): void {
        this.multiModalOption = multiModalOption
    }

    /**
     * Check if the configured model is an Anthropic model (routed via OpenRouter)
     */
    private isAnthropicModel(): boolean {
        const model = (this.configuredModel || '').toLowerCase()
        return model.includes('anthropic/') || model.includes('claude')
    }

    /**
     * Inject cache_control into system messages for Anthropic models via OpenRouter.
     * This enables prompt caching which reduces input token costs by ~90%.
     *
     * OpenRouter passes cache_control to Anthropic's API when present on message content blocks.
     * See: https://openrouter.ai/docs/features/prompt-caching
     */
    private injectCacheControl(messages: BaseMessage[]): BaseMessage[] {
        if (!this.enablePromptCaching || !this.isAnthropicModel()) {
            return messages
        }

        return messages.map((msg, index) => {
            // Cache system messages and the last large human message (for RAG/context)
            const shouldCache = msg instanceof SystemMessage || (index === messages.length - 2 && msg instanceof HumanMessage) // second-to-last = context

            if (!shouldCache) return msg

            const content = msg.content
            if (typeof content === 'string') {
                // Convert string content to content block with cache_control
                const newMsg =
                    msg instanceof SystemMessage
                        ? new SystemMessage({
                              content: [{ type: 'text', text: content, cache_control: { type: 'ephemeral' } } as any]
                          })
                        : new HumanMessage({
                              content: [{ type: 'text', text: content, cache_control: { type: 'ephemeral' } } as any]
                          })
                // Preserve additional_kwargs
                newMsg.additional_kwargs = { ...msg.additional_kwargs }
                return newMsg
            } else if (Array.isArray(content) && content.length > 0) {
                // Add cache_control to the last content block
                const newContent = [...content]
                const lastBlock = { ...newContent[newContent.length - 1] }
                ;(lastBlock as any).cache_control = { type: 'ephemeral' }
                newContent[newContent.length - 1] = lastBlock

                const newMsg =
                    msg instanceof SystemMessage ? new SystemMessage({ content: newContent }) : new HumanMessage({ content: newContent })
                newMsg.additional_kwargs = { ...msg.additional_kwargs }
                return newMsg
            }

            return msg
        })
    }

    /**
     * Override _generate to inject cache_control before sending to OpenRouter/Anthropic
     */
    async _generate(messages: BaseMessage[], options: any, runManager?: any): Promise<ChatResult> {
        const cachedMessages = this.injectCacheControl(messages)

        // Log when cache_control injection is applied
        if (cachedMessages !== messages) {
            const cachedCount = cachedMessages.filter((m) => Array.isArray(m.content) && m.content.some((b: any) => b.cache_control)).length
            if (isOpenRouterDebugEnabled()) {
                console.debug(
                    `[OpenRouter] Prompt caching: injected cache_control into ${cachedCount} message(s) for ${this.configuredModel}`
                )
            }
        }

        const result = await super._generate(cachedMessages, options, runManager)

        // Log cache usage stats if available in the response (Anthropic returns these via OpenRouter)
        const usage = result.llmOutput?.tokenUsage || result.llmOutput?.usage
        if (usage) {
            const cacheRead = usage.cache_read_input_tokens ?? usage.cacheReadInputTokens ?? 0
            const cacheCreation = usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens ?? 0
            if (isOpenRouterDebugEnabled() && (cacheRead > 0 || cacheCreation > 0)) {
                console.debug(
                    `[OpenRouter] Cache stats: read=${cacheRead} tokens, creation=${cacheCreation} tokens (model=${this.configuredModel})`
                )
            }
        }

        return result
    }
}
