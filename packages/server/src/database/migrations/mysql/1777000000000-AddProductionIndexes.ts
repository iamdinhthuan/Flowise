import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddProductionIndexes1777000000000 implements MigrationInterface {
    name = 'AddProductionIndexes1777000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE INDEX \`IDX_chat_message_flow_session_created\` ON \`chat_message\` (\`chatflowid\`, \`sessionId\`, \`createdDate\`)`
        )
        await queryRunner.query(
            `CREATE INDEX \`IDX_chat_message_flow_chat_created\` ON \`chat_message\` (\`chatflowid\`, \`chatId\`, \`createdDate\`)`
        )
        await queryRunner.query(`CREATE INDEX \`IDX_chat_message_flow_created\` ON \`chat_message\` (\`chatflowid\`, \`createdDate\`)`)
        await queryRunner.query(
            `CREATE INDEX \`IDX_chat_feedback_flow_rating_created\` ON \`chat_message_feedback\` (\`chatflowid\`, \`rating\`, \`createdDate\`)`
        )
        await queryRunner.query(
            `CREATE INDEX \`IDX_execution_agent_session_updated\` ON \`execution\` (\`agentflowId\`, \`sessionId\`, \`updatedDate\`)`
        )
        await queryRunner.query(
            `CREATE INDEX \`IDX_chat_flow_workspace_type_updated\` ON \`chat_flow\` (\`workspaceId\`(191), \`type\`, \`updatedDate\`)`
        )
        await queryRunner.query(
            `CREATE INDEX \`IDX_doc_store_workspace_status_updated\` ON \`document_store\` (\`workspaceId\`(191), \`status\`(191), \`updatedDate\`)`
        )
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX \`IDX_doc_store_workspace_status_updated\` ON \`document_store\``)
        await queryRunner.query(`DROP INDEX \`IDX_chat_flow_workspace_type_updated\` ON \`chat_flow\``)
        await queryRunner.query(`DROP INDEX \`IDX_execution_agent_session_updated\` ON \`execution\``)
        await queryRunner.query(`DROP INDEX \`IDX_chat_feedback_flow_rating_created\` ON \`chat_message_feedback\``)
        await queryRunner.query(`DROP INDEX \`IDX_chat_message_flow_created\` ON \`chat_message\``)
        await queryRunner.query(`DROP INDEX \`IDX_chat_message_flow_chat_created\` ON \`chat_message\``)
        await queryRunner.query(`DROP INDEX \`IDX_chat_message_flow_session_created\` ON \`chat_message\``)
    }
}
