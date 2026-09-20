import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CustomDialog } from '@/components/custom-dialog';
import { TopAppHeader } from '@/components/top-app-header';
import { FlowScreenHeader } from '@/components/wallet/flow-screen-header';
import { withAlpha } from '@/components/wallet/utils';
import { FretixColors } from '@/constants/theme';
import { useAppData } from '@/context/AppDataContext';
import { LoadProposal, proposalService } from '@/services/proposals';

import { ProposalCard, type ProposalCardData } from './proposal-card';

type ProposalsReceivedScreenProps = {
  variant?: 'tab' | 'flow';
};

function formatValue(value: number | null) {
  return `${(value ?? 0).toLocaleString('pt-MZ', { minimumFractionDigits: 2 })} MT`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('pt-MZ', { day: '2-digit', month: 'short', year: 'numeric' });
}

function toCardData(proposal: LoadProposal): ProposalCardData {
  const companyName = proposal.company?.company_name;
  const driverName = proposal.driver?.name;
  const avatarUrl = proposal.company?.logo_url || proposal.driver?.avatar_url || undefined;

  return {
    id: String(proposal.id),
    driverName: companyName ?? driverName ?? 'Transportador',
    rating: proposal.company?.average_rating ?? proposal.driver?.average_rating ?? 0,
    reviewCount: proposal.company?.total_trips ?? proposal.driver?.total_trips ?? 0,
    amount: formatValue(proposal.proposed_value),
    deliveryBy: formatDate(proposal.load.departure_date),
    durationBadge: proposal.vehicle?.plate ?? proposal.status,
    avatar: avatarUrl,
  };
}

export function ProposalsReceivedScreen({ variant = 'flow' }: ProposalsReceivedScreenProps) {
  const [sortIndex, setSortIndex] = useState(0);
  const { receivedProposals, loadReceivedProposalsIfNeeded, refreshReceivedProposals } = useAppData();
  const sortOptions = ['Menor valor', 'Maior valor', 'Melhor avaliacao', 'Mais recentes'];
  const sortBy = sortOptions[sortIndex];

  const [dialogConfig, setDialogConfig] = useState<{
    visible: boolean;
    title: string;
    message: string;
    type?: 'success' | 'error' | 'info';
  }>({
    visible: false,
    title: '',
    message: '',
  });

  useEffect(() => {
    loadReceivedProposalsIfNeeded();
  }, [loadReceivedProposalsIfNeeded]);

  const proposals = receivedProposals.data;

  const sortedProposals = useMemo(() => {
    return [...proposals].sort((a, b) => {
      if (sortBy === 'Maior valor') {
        return (b.proposed_value ?? 0) - (a.proposed_value ?? 0);
      }

      if (sortBy === 'Melhor avaliacao') {
        return (b.company?.average_rating ?? b.driver?.average_rating ?? 0) -
          (a.company?.average_rating ?? a.driver?.average_rating ?? 0);
      }

      if (sortBy === 'Mais recentes') {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }

      return (a.proposed_value ?? 0) - (b.proposed_value ?? 0);
    });
  }, [proposals, sortBy]);

  const headerLoad = sortedProposals[0]?.load;

  const handleAccept = async (proposalId: number) => {
    try {
      await proposalService.acceptProposal(proposalId);
      await refreshReceivedProposals();
    } catch (error: any) {
      console.error('Failed to accept proposal:', error.response?.data || error.message);
      setDialogConfig({
        visible: true,
        title: 'Erro',
        message: error.response?.data?.detail || 'Não foi possível aceitar a proposta.',
        type: 'error',
      });
    }
  };

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={receivedProposals.isRefreshing}
              onRefresh={refreshReceivedProposals}
              colors={[FretixColors.yellow]}
              tintColor={FretixColors.yellow}
            />
          }>
          {variant === 'tab' ? (
            <>
              <TopAppHeader />
              <Text style={styles.pageTitle}>Propostas recebidas</Text>
            </>
          ) : (
            <FlowScreenHeader title="Propostas recebidas" />
          )}

          <View style={styles.cargoCard}>
            <View style={styles.cargoTop}>
              <View style={styles.cargoMain}>
                <Text style={styles.cargoId}>{headerLoad ? `#${headerLoad.code}` : 'Todas as cargas'}</Text>
                <Text style={styles.cargoRoute}>
                  {headerLoad ? `${headerLoad.origin} -> ${headerLoad.destination}` : 'Propostas nas suas cargas'}
                </Text>
                <Text style={styles.cargoDates}>
                  {headerLoad ? `${formatDate(headerLoad.departure_date)} · ${headerLoad.load_name}` : 'Propostas disponíveis'}
                </Text>
              </View>
              <View style={styles.availableBadge}>
                <Text style={styles.availableText}>{proposals.length}</Text>
              </View>
            </View>
          </View>

          <Pressable
            style={styles.sortRow}
            onPress={() => setSortIndex((i) => (i + 1) % sortOptions.length)}
            accessibilityRole="button">
            <Text style={styles.sortLabel}>Ordenar por</Text>
            <View style={styles.sortValue}>
              <Text style={styles.sortValueText}>{sortBy}</Text>
              <Ionicons name="chevron-down" size={16} color={FretixColors.grayLight} />
            </View>
          </Pressable>

          <View style={styles.list}>
            {receivedProposals.isLoading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={FretixColors.yellow} />
              </View>
            ) : sortedProposals.length === 0 ? (
              <Text style={styles.emptyText}>Nenhuma proposta recebida</Text>
            ) : (
              sortedProposals.map((proposal) => (
                <ProposalCard
                  key={proposal.id}
                  proposal={toCardData(proposal)}
                  showActions={proposal.status === 'pendente' || proposal.status === 'em_negociacao'}
                  onAccept={() => handleAccept(proposal.id)}
                  onNegotiate={
                    proposal.load.negotiable
                      ? () =>
                          router.push({
                            pathname: '/negotiation',
                            params: { proposalId: String(proposal.id) },
                          })
                      : undefined
                  }
                />
              ))
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
      <CustomDialog
        visible={dialogConfig.visible}
        title={dialogConfig.title}
        message={dialogConfig.message}
        type={dialogConfig.type}
        onConfirm={() => setDialogConfig((prev) => ({ ...prev, visible: false }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: FretixColors.black,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 14,
  },
  pageTitle: {
    color: FretixColors.white,
    fontSize: 22,
    fontWeight: '700',
    marginTop: 8,
  },
  cargoCard: {
    backgroundColor: '#111723',
    borderWidth: 1,
    borderColor: '#273444',
    borderRadius: 14,
    padding: 14,
    marginTop: 4,
  },
  cargoTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  cargoMain: {
    flex: 1,
    gap: 4,
  },
  cargoId: {
    color: FretixColors.yellow,
    fontSize: 13,
    fontWeight: '700',
  },
  cargoRoute: {
    color: FretixColors.white,
    fontSize: 16,
    fontWeight: '700',
  },
  cargoDates: {
    color: FretixColors.grayLight,
    fontSize: 12,
  },
  availableBadge: {
    backgroundColor: withAlpha('#22C55E', 0.16),
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  availableText: {
    color: '#86EFAC',
    fontSize: 11,
    fontWeight: '700',
  },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: '#111723',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#273241',
    padding: 4,
    gap: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 999,
  },
  tabActive: {
    backgroundColor: FretixColors.yellow,
  },
  tabText: {
    color: '#8D949E',
    fontSize: 12,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#101217',
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sortLabel: {
    color: FretixColors.grayLight,
    fontSize: 13,
  },
  sortValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sortValueText: {
    color: FretixColors.white,
    fontSize: 13,
    fontWeight: '600',
  },
  list: {
    gap: 10,
  },
  loadingBox: {
    padding: 20,
    alignItems: 'center',
  },
  emptyText: {
    color: FretixColors.grayLight,
    textAlign: 'center',
    padding: 20,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 8,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    color: FretixColors.white,
    fontSize: 16,
    fontWeight: '700',
  },
  emptySubtitle: {
    color: FretixColors.grayLight,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
});
