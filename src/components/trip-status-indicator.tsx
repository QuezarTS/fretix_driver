import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FretixColors } from '@/constants/theme';

export type LoadStatusType =
    | 'aceite'
    | 'disponivel'
    | 'indo_carregar'
    | 'chegou_origem'
    | 'carregado'
    | 'em_andamento'
    | 'em_viagem'
    | 'concluido'
    | 'concluida'
    | 'cancelado'
    | 'cancelada';

interface StatusConfig {
    label: string;
    color: string;
    backgroundColor: string;
    icon: keyof typeof Ionicons.glyphMap;
    progressPercentage?: number;
}

const STATUS_CONFIG: Record<LoadStatusType, StatusConfig> = {
    aceite: {
        label: 'Aceite',
        color: '#22C55E',
        backgroundColor: 'rgba(34, 197, 94, 0.14)',
        icon: 'checkmark-circle-outline',
        progressPercentage: 10,
    },
    disponivel: {
        label: 'Aguardando Início',
        color: '#6B7280',
        backgroundColor: 'rgba(107, 114, 128, 0.14)',
        icon: 'time-outline',
    },
    indo_carregar: {
        label: 'Indo Carregar',
        color: '#8B5CF6',
        backgroundColor: 'rgba(139, 92, 246, 0.16)',
        icon: 'navigate-outline',
        progressPercentage: 20,
    },
    chegou_origem: {
        label: 'Na Origem',
        color: '#EC4899',
        backgroundColor: 'rgba(236, 72, 153, 0.16)',
        icon: 'location-outline',
        progressPercentage: 35,
    },
    carregado: {
        label: 'Carga Carregada',
        color: '#10B981',
        backgroundColor: 'rgba(16, 185, 129, 0.16)',
        icon: 'cube-outline',
        progressPercentage: 50,
    },
    em_andamento: {
        label: 'Confirmação pendente',
        color: '#F59E0B',
        backgroundColor: 'rgba(245, 158, 11, 0.16)',
        icon: 'hourglass-outline',
        progressPercentage: 85,
    },
    em_viagem: {
        label: 'Em Viagem',
        color: '#3B82F6',
        backgroundColor: 'rgba(59, 130, 246, 0.14)',
        icon: 'car-outline',
        progressPercentage: 70,
    },
    concluido: {
        label: 'Concluído',
        color: '#10B981',
        backgroundColor: 'rgba(16, 185, 129, 0.14)',
        icon: 'checkmark-done-circle-outline',
        progressPercentage: 100,
    },
    concluida: {
        label: 'Concluída',
        color: '#10B981',
        backgroundColor: 'rgba(16, 185, 129, 0.14)',
        icon: 'checkmark-done-circle-outline',
        progressPercentage: 100,
    },
    cancelado: {
        label: 'Cancelado',
        color: '#EF4444',
        backgroundColor: 'rgba(239, 68, 68, 0.14)',
        icon: 'close-circle-outline',
    },
    cancelada: {
        label: 'Cancelada',
        color: '#EF4444',
        backgroundColor: 'rgba(239, 68, 68, 0.14)',
        icon: 'close-circle-outline',
    },
};

interface TripStatusIndicatorProps {
    status: LoadStatusType;
    size?: 'small' | 'medium' | 'large';
    showProgress?: boolean;
    compact?: boolean;
}

/**
 * Componente para exibir o status de uma viagem/carga em tempo real
 *
 * @param status - Status da viagem
 * @param size - Tamanho do indicador (small, medium, large)
 * @param showProgress - Mostrar barra de progresso
 * @param compact - Modo compacto (apenas ícone e label curto)
 */
export function TripStatusIndicator({
    status,
    size = 'medium',
    showProgress = false,
    compact = false,
}: TripStatusIndicatorProps) {
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.disponivel;

    const sizeConfig = {
        small: { iconSize: 16, padding: 6, fontSize: 12 },
        medium: { iconSize: 20, padding: 10, fontSize: 14 },
        large: { iconSize: 28, padding: 12, fontSize: 16 },
    };

    const { iconSize, padding, fontSize } = sizeConfig[size];

    if (compact) {
        return (
            <View style={styles.compactContainer}>
                <Ionicons name={config.icon} size={iconSize} color={config.color} />
                <Text style={[styles.compactLabel, { color: config.color, fontSize }]}>
                    {config.label}
                </Text>
            </View>
        );
    }

    return (
        <View>
            <View
                style={[
                    styles.container,
                    {
                        backgroundColor: config.backgroundColor,
                        padding,
                    },
                ]}
            >
                <View style={styles.contentRow}>
                    <Ionicons name={config.icon} size={iconSize} color={config.color} />
                    <Text style={[styles.label, { color: config.color, fontSize }]}>
                        {config.label}
                    </Text>
                </View>
            </View>

            {showProgress && config.progressPercentage !== undefined && (
                <View style={styles.progressContainer}>
                    <View
                        style={[
                            styles.progressBar,
                            {
                                width: `${config.progressPercentage}%`,
                                backgroundColor: config.color,
                            },
                        ]}
                    />
                </View>
            )}
        </View>
    );
}

/**
 * Badge compacto para usar em listas
 */
export function TripStatusBadge({ status }: { status: LoadStatusType }) {
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.disponivel;

    return (
        <View
            style={[
                styles.badge,
                {
                    backgroundColor: config.backgroundColor,
                    borderColor: config.color,
                },
            ]}
        >
            <Ionicons name={config.icon} size={14} color={config.color} />
            <Text style={[styles.badgeLabel, { color: config.color }]}>
                {config.label}
            </Text>
        </View>
    );
}

/**
 * Timeline visual para mostrar progresso de viagem
 */
interface TripTimelineProps {
    status: LoadStatusType;
    currentStep?: 'picking' | 'in_transit' | 'delivered';
}

export function TripTimeline({ status, currentStep = 'picking' }: TripTimelineProps) {
    const steps = [
        { id: 'picking', label: 'Coleta', icon: 'pin-outline' as const },
        { id: 'in_transit', label: 'Em Trânsito', icon: 'car-outline' as const },
        { id: 'delivered', label: 'Entregue', icon: 'checkmark-circle-outline' as const },
    ];

    const getStepStatus = (stepId: string) => {
        if (stepId === currentStep) return 'active';
        if (['picking', 'in_transit', 'delivered'].indexOf(stepId) <
            ['picking', 'in_transit', 'delivered'].indexOf(currentStep)) {
            return 'completed';
        }
        return 'pending';
    };

    return (
        <View style={styles.timelineContainer}>
            {steps.map((step, index) => (
                <View key={step.id} style={styles.stepWrapper}>
                    <View
                        style={[
                            styles.stepCircle,
                            {
                                backgroundColor:
                                    getStepStatus(step.id) === 'completed'
                                        ? FretixColors.yellow
                                        : getStepStatus(step.id) === 'active'
                                            ? FretixColors.yellow
                                            : '#D1D5DB',
                            },
                        ]}
                    >
                        <Ionicons
                            name={step.icon}
                            size={16}
                            color={getStepStatus(step.id) === 'pending' ? '#9CA3AF' : '#000'}
                        />
                    </View>
                    <Text style={styles.stepLabel}>{step.label}</Text>
                    {index < steps.length - 1 && (
                        <View
                            style={[
                                styles.stepConnector,
                                {
                                    backgroundColor:
                                        getStepStatus(steps[index + 1].id) === 'completed'
                                            ? FretixColors.yellow
                                            : '#D1D5DB',
                                },
                            ]}
                        />
                    )}
                </View>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        borderRadius: 8,
        alignItems: 'flex-start',
    },
    contentRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    label: {
        fontWeight: '600',
    },
    compactContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        gap: 6,
    },
    compactLabel: {
        fontWeight: '500',
    },
    progressContainer: {
        height: 4,
        backgroundColor: '#E5E7EB',
        borderRadius: 2,
        marginTop: 8,
        overflow: 'hidden',
    },
    progressBar: {
        height: '100%',
        borderRadius: 2,
    },
    badge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
        borderWidth: 0.8,
        gap: 4,
    },
    badgeLabel: {
        fontSize: 12,
        fontWeight: '500',
    },
    timelineContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 16,
        gap: 8,
    },
    stepWrapper: {
        alignItems: 'center',
        flex: 1,
    },
    stepCircle: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 8,
    },
    stepLabel: {
        fontSize: 12,
        color: '#6B7280',
        textAlign: 'center',
    },
    stepConnector: {
        height: 2,
        flex: 1,
        alignSelf: 'flex-start',
        marginTop: -32,
        zIndex: -1,
    },
});
