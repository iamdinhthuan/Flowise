import { Document } from '@langchain/core/documents'
import { Callbacks } from '@langchain/core/callbacks/manager'
import { BaseLanguageModel } from '@langchain/core/language_models/base'
import { VectorStoreRetriever } from '@langchain/core/vectorstores'
import { ChatPromptTemplate, HumanMessagePromptTemplate, SystemMessagePromptTemplate } from '@langchain/core/prompts'
import { LLMChain } from '@langchain/classic/chains'
import { BaseDocumentCompressor } from '@langchain/classic/retrievers/document_compressors'

export class ReciprocalRankFusion extends BaseDocumentCompressor {
    private readonly llm: BaseLanguageModel
    private readonly queryCount: number
    private readonly topK: number
    private readonly c: number
    private baseRetriever: VectorStoreRetriever
    constructor(llm: BaseLanguageModel, baseRetriever: VectorStoreRetriever, queryCount: number, topK: number, c: number) {
        super()
        this.queryCount = queryCount
        this.llm = llm
        this.baseRetriever = baseRetriever
        this.topK = topK
        this.c = c
    }
    async compressDocuments(
        documents: Document<Record<string, any>>[],
        query: string,
        _?: Callbacks | undefined
    ): Promise<Document<Record<string, any>>[]> {
        // avoid empty api call
        if (documents.length === 0) {
            return []
        }
        const chatPrompt = ChatPromptTemplate.fromMessages([
            SystemMessagePromptTemplate.fromTemplate(
                'You are a helpful assistant that generates multiple search queries based on a single input query.'
            ),
            HumanMessagePromptTemplate.fromTemplate(
                'Generate multiple search queries related to: {input}. Provide these alternative questions separated by newlines, do not add any numbers.'
            ),
            HumanMessagePromptTemplate.fromTemplate('OUTPUT (' + this.queryCount + ' queries):')
        ])
        const llmChain = new LLMChain({
            llm: this.llm,
            prompt: chatPrompt
        })
        const multipleQueries = await llmChain.call({ input: query })
        const generatedQueries = multipleQueries.text
            .split('\n')
            .map((q: string) => q.trim())
            .filter(Boolean)
            .slice(0, this.queryCount)
        const queries = Array.from(new Set([query, ...generatedQueries]))
        const docList = await Promise.all(
            queries.map((searchQuery) => this.baseRetriever.vectorStore.similaritySearch(searchQuery, this.topK, this.baseRetriever.filter))
        )

        return this.reciprocalRankFunction(docList, this.c)
    }

    reciprocalRankFunction(docList: Document<Record<string, any>>[][], k: number): Document<Record<string, any>>[] {
        const rankedDocuments = new Map<string, { doc: Document<Record<string, any>>; score: number }>()

        const getDocumentKey = (doc: Document<Record<string, any>>): string => {
            const metadata = { ...(doc.metadata ?? {}) }
            delete metadata.relevancy_score
            return `${doc.pageContent}|${JSON.stringify(metadata)}`
        }

        docList.forEach((docs: Document<Record<string, any>>[]) => {
            docs.forEach((doc: any, index: number) => {
                const rank = index + 1
                const score = 1 / (rank + k)
                const key = getDocumentKey(doc)
                const existingDoc = rankedDocuments.get(key)
                if (existingDoc) {
                    existingDoc.score += score
                } else {
                    rankedDocuments.set(key, {
                        doc: new Document({
                            pageContent: doc.pageContent,
                            metadata: {
                                ...(doc.metadata ?? {}),
                                relevancy_score: score
                            }
                        }),
                        score
                    })
                }
            })
        })

        return Array.from(rankedDocuments.values())
            .map(({ doc, score }) => {
                doc.metadata.relevancy_score = score
                return doc
            })
            .sort((a, b) => b.metadata.relevancy_score - a.metadata.relevancy_score)
            .slice(0, this.topK)
    }
}
