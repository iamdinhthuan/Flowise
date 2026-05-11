import { useConfig } from '@/store/context/ConfigContext'
import { useSelector } from 'react-redux'
import { Navigate } from 'react-router-dom'

// Only import what we actually use
import Agentflows from '@/views/agentflows'

/**
 * Component that always shows Agentflows
 * For Open Source: skip auth, render immediately
 */
export const DefaultRedirect = () => {
    const { loading, isOpenSource, openSourceAuthEnabled } = useConfig()
    const currentUser = useSelector((state) => state.auth.user)

    // Wait for config to load before rendering
    if (loading) {
        return null
    }

    if (isOpenSource && openSourceAuthEnabled && !currentUser) {
        return <Navigate to='/login' replace />
    }

    // Always show Agentflows (chatflows, assistants, marketplace removed)
    return <Agentflows />
}
