import { getBezierPath, EdgeText } from 'reactflow'
import PropTypes from 'prop-types'
import { useDispatch } from 'react-redux'
import { useContext, memo } from 'react'
import { SET_DIRTY } from '@/store/actions'
import { flowContext } from '@/store/context/ReactFlowContext'
import { IconX } from '@tabler/icons-react'

import './index.css'

const foreignObjectSize = 40

const ButtonEdge = ({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style = {}, data, markerEnd }) => {
    const [edgePath, edgeCenterX, edgeCenterY] = getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition
    })

    const { deleteEdge } = useContext(flowContext)

    const dispatch = useDispatch()

    const onEdgeClick = (evt, id) => {
        evt.stopPropagation()
        deleteEdge(id)
        dispatch({ type: SET_DIRTY })
    }

    return (
        <>
            <path id={id} style={style} className='react-flow__edge-path flowise-button-edge-path' d={edgePath} markerEnd={markerEnd} />
            <path
                className='flowise-edge-travel flowise-edge-travel-glow flowise-button-edge-travel'
                style={{
                    stroke: style.stroke || '#2a8af6',
                    strokeWidth: Number(style.strokeWidth) > 2 ? Number(style.strokeWidth) + 5 : 7,
                    opacity: 0.28
                }}
                d={edgePath}
                pathLength={1}
                vectorEffect='non-scaling-stroke'
            />
            <path
                className='flowise-edge-travel flowise-edge-travel-core flowise-button-edge-travel'
                style={{
                    stroke: style.stroke || '#2a8af6',
                    strokeWidth: Number(style.strokeWidth) > 2 ? Number(style.strokeWidth) + 1 : 3,
                    opacity: 0.72
                }}
                d={edgePath}
                pathLength={1}
                vectorEffect='non-scaling-stroke'
            />
            {data && data.label && (
                <EdgeText
                    x={sourceX + 10}
                    y={sourceY + 10}
                    label={data.label}
                    labelStyle={{ fill: 'black' }}
                    labelBgStyle={{ fill: 'transparent' }}
                    labelBgPadding={[2, 4]}
                    labelBgBorderRadius={2}
                />
            )}
            <foreignObject
                width={foreignObjectSize}
                height={foreignObjectSize}
                x={edgeCenterX - foreignObjectSize / 2}
                y={edgeCenterY - foreignObjectSize / 2}
                className='edgebutton-foreignobject'
                requiredExtensions='http://www.w3.org/1999/xhtml'
            >
                <div>
                    <button className='edgebutton flowise-edgebutton' onClick={(event) => onEdgeClick(event, id)}>
                        <IconX stroke={2} size='12' />
                    </button>
                </div>
            </foreignObject>
        </>
    )
}

ButtonEdge.propTypes = {
    id: PropTypes.string,
    sourceX: PropTypes.number,
    sourceY: PropTypes.number,
    targetX: PropTypes.number,
    targetY: PropTypes.number,
    sourcePosition: PropTypes.any,
    targetPosition: PropTypes.any,
    style: PropTypes.object,
    data: PropTypes.object,
    markerEnd: PropTypes.any
}

export default memo(ButtonEdge)
