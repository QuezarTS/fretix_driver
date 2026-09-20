import type { ImagePickerAsset } from 'expo-image-picker';

import api from './api';

export type EvidenceStage = 'pickup' | 'delivery';
export type EvidenceType = 'pickup_photo' | 'delivery_photo' | 'proof_of_delivery';

export interface TripEvidence {
  id: number;
  trip_id: number;
  load_id: number;
  evidence_type: EvidenceType;
  file_url: string;
  mime_type: string;
  original_name: string;
  notes?: string | null;
  created_at: string;
}

export interface EvidenceStageSummary {
  photo_count: number;
  min_photos: number;
  max_photos: number;
  ready_to_finalize: boolean;
  finalized: boolean;
  finalized_at?: string | null;
  proof_of_delivery_count?: number;
  proof_of_delivery_required?: boolean;
}

export interface TripEvidenceSummary {
  trip_id: number;
  load_id: number;
  pickup: EvidenceStageSummary;
  delivery: EvidenceStageSummary;
}

function uploadName(asset: ImagePickerAsset, evidenceType: EvidenceType) {
  const extension = asset.mimeType?.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  return asset.fileName || `${evidenceType}-${Date.now()}.${extension}`;
}

export const tripEvidenceService = {
  async list(tripId: number | string): Promise<TripEvidence[]> {
    const response = await api.get(`/trip-evidence/${tripId}`);
    return response.data;
  },

  async summary(tripId: number | string): Promise<TripEvidenceSummary> {
    const response = await api.get(`/trip-evidence/${tripId}/summary`);
    return response.data;
  },

  async upload(
    tripId: number | string,
    evidenceType: EvidenceType,
    asset: ImagePickerAsset,
  ): Promise<TripEvidence> {
    const form = new FormData();
    form.append('evidence_type', evidenceType);
    form.append('file', {
      uri: asset.uri,
      name: uploadName(asset, evidenceType),
      type: asset.mimeType || 'image/jpeg',
    } as any);

    const response = await api.post(`/trip-evidence/${tripId}/upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  async finalize(
    tripId: number | string,
    stage: EvidenceStage,
  ): Promise<TripEvidenceSummary> {
    const response = await api.post(`/trip-evidence/${tripId}/finalize/${stage}`);
    return response.data;
  },

  async remove(tripId: number | string, evidenceId: number): Promise<void> {
    await api.delete(`/trip-evidence/${tripId}/${evidenceId}`);
  },
};
