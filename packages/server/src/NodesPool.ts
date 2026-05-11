import { IComponentNodes, IComponentCredentials } from './Interface'
import path from 'path'
import { Dirent } from 'fs'
import { getNodeModulesPackagePath } from './utils'
import { promises } from 'fs'
import { ICommonObject } from 'flowise-components'
import logger from './utils/logger'
import { appConfig } from './AppConfig'

export class NodesPool {
    componentNodes: IComponentNodes = {}
    componentCredentials: IComponentCredentials = {}
    private credentialIconPath: ICommonObject = {}

    /**
     * Initialize to get all nodes & credentials
     */
    async initialize() {
        await this.initializeNodes()
        await this.initializeCredentials()
    }

    /**
     * Initialize nodes
     */
    private async initializeNodes() {
        const packagePath = getNodeModulesPackagePath('flowise-components')
        const nodesPath = path.join(packagePath, 'dist', 'nodes')
        const nodes = await this.loadNodesFromDir(nodesPath)
        Object.assign(this.componentNodes, nodes)
    }

    /**
     * Load and filter nodes from a directory.
     */
    async loadNodesFromDir(dir: string): Promise<IComponentNodes> {
        const disabled_nodes = process.env.DISABLED_NODES ? process.env.DISABLED_NODES.split(',') : []

        // Skip entire node categories for lightweight deployments
        // Default chatflow-only categories to skip in LITE_MODE
        const defaultDisabledCategories = 'agents,chains,memory,prompts,outputparsers,multiagents,sequentialagents,graphs,llms,engine,responsesynthesizer,speechtotext'
        const disabled_categories = process.env.DISABLED_NODE_CATEGORIES
            ? process.env.DISABLED_NODE_CATEGORIES.split(',')
            : process.env.LITE_MODE === 'true'
              ? defaultDisabledCategories.split(',')
              : []

        const nodes: IComponentNodes = {}
        const nodeFiles = await this.getFiles(dir)
        await Promise.all(
            nodeFiles.map(async (file) => {
                if (file.endsWith('.js')) {
                    // Skip files in disabled categories (check directory name)
                    if (disabled_categories.length > 0) {
                        const fileParts = file.replace(/\\/g, '/').split('/')
                        const nodesIdx = fileParts.lastIndexOf('nodes')
                        if (nodesIdx !== -1 && nodesIdx + 1 < fileParts.length) {
                            const categoryDir = fileParts[nodesIdx + 1]
                            if (disabled_categories.includes(categoryDir)) {
                                return
                            }
                        }
                    }

                    try {
                        const nodeModule = await require(file)

                        if (nodeModule.nodeClass) {
                            const newNodeInstance = new nodeModule.nodeClass()
                            newNodeInstance.filePath = file

                            // Replace file icon with absolute path
                            if (
                                newNodeInstance.icon &&
                                (newNodeInstance.icon.endsWith('.svg') ||
                                    newNodeInstance.icon.endsWith('.png') ||
                                    newNodeInstance.icon.endsWith('.jpg'))
                            ) {
                                const filePath = file.replace(/\\/g, '/').split('/')
                                filePath.pop()
                                const nodeIconAbsolutePath = `${filePath.join('/')}/${newNodeInstance.icon}`
                                newNodeInstance.icon = nodeIconAbsolutePath

                                // Store icon path for componentCredentials
                                if (newNodeInstance.credential) {
                                    for (const credName of newNodeInstance.credential.credentialNames) {
                                        this.credentialIconPath[credName] = nodeIconAbsolutePath
                                    }
                                }
                            }

                            const skipCategories = ['Analytic', 'SpeechToText']
                            const conditionOne = !skipCategories.includes(newNodeInstance.category)

                            const isCommunityNodesAllowed = appConfig.showCommunityNodes
                            const isAuthorPresent = newNodeInstance.author
                            let conditionTwo = true
                            if (!isCommunityNodesAllowed && isAuthorPresent) conditionTwo = false

                            const isDisabled = disabled_nodes.includes(newNodeInstance.name)

                            if (conditionOne && conditionTwo && !isDisabled) {
                                nodes[newNodeInstance.name] = newNodeInstance
                            }
                        }
                    } catch (err) {
                        logger.error(`❌ [server]: Error during initDatabase with file ${file}:`, err)
                    }
                }
            })
        )
        if (disabled_categories.length > 0) {
            logger.info(`⚡ [server]: Skipped node categories: ${disabled_categories.join(', ')}`)
        }
        logger.info(`🔧 [server]: Loaded ${Object.keys(nodes).length} nodes`)
        return nodes
    }

    /**
     * Initialize credentials
     */
    private async initializeCredentials() {
        const packagePath = getNodeModulesPackagePath('flowise-components')
        const nodesPath = path.join(packagePath, 'dist', 'credentials')
        const nodeFiles = await this.getFiles(nodesPath)
        return Promise.all(
            nodeFiles.map(async (file) => {
                if (file.endsWith('.credential.js')) {
                    const credentialModule = await require(file)
                    if (credentialModule.credClass) {
                        const newCredInstance = new credentialModule.credClass()
                        newCredInstance.icon = this.credentialIconPath[newCredInstance.name] ?? ''
                        this.componentCredentials[newCredInstance.name] = newCredInstance
                    }
                }
            })
        )
    }

    /**
     * Recursive function to get node files
     * @param {string} dir
     * @returns {string[]}
     */
    private async getFiles(dir: string): Promise<string[]> {
        const dirents = await promises.readdir(dir, { withFileTypes: true })
        const files = await Promise.all(
            dirents.map((dirent: Dirent) => {
                const res = path.resolve(dir, dirent.name)
                return dirent.isDirectory() ? this.getFiles(res) : res
            })
        )
        return Array.prototype.concat(...files)
    }
}
