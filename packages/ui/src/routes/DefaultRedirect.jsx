import { useConfig } from '@/store/context/ConfigContext'

// Only import what we actually use
import Agentflows from '@/views/agentflows'

/**
 * Component that always shows Agentflows
 * For Open Source: skip auth, render immediately
 */
export const DefaultRedirect = () => {
    const { loading } = useConfig()

    // Wait for config to load before rendering
    if (loading) {
        return null
    }

    // Always show Agentflows (chatflows, assistants, marketplace removed)
    return <Agentflows />
}
