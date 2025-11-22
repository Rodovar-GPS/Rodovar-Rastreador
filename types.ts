export enum TrackingStatus {
  PENDING = 'PENDING',
  IN_TRANSIT = 'IN_TRANSIT',
  STOPPED = 'STOPPED', // Parado
  DELIVERED = 'DELIVERED',
  DELAYED = 'DELAYED',
  EXCEPTION = 'EXCEPTION'
}

export const StatusLabels: Record<TrackingStatus, string> = {
  [TrackingStatus.PENDING]: 'Aguardando Coleta',
  [TrackingStatus.IN_TRANSIT]: 'Em Trânsito',
  [TrackingStatus.STOPPED]: 'Parado / Descanso',
  [TrackingStatus.DELIVERED]: 'Entregue',
  [TrackingStatus.DELAYED]: 'Atrasado',
  [TrackingStatus.EXCEPTION]: 'Problema / Retido'
};

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface UserAddress {
  road?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  country?: string;
  formatted?: string;
}

export interface Expense {
  id: string;
  category: 'Combustível' | 'Manutenção' | 'Alimentação' | 'Outros';
  description: string;
  value: number;
  date: string;
}

export interface TrackingData {
  code: string;
  status: TrackingStatus;
  currentLocation: {
    city: string;
    state: string;
    address?: string; // Endereço detalhado (Rua, Posto, etc.)
    coordinates: Coordinates;
  };
  origin: string;
  destination: string;
  destinationAddress?: string; // Endereço detalhado do destino
  destinationCoordinates?: Coordinates; // Coordenadas do destino para o mapa
  lastUpdate: string;
  estimatedDelivery: string;
  message: string;
  notes?: string; // Notas do ADMIN
  progress: number; // 0 to 100

  // Novos campos do Motorista
  driverNotes?: string;
  
  // Lista de Despesas (Histórico)
  expenses?: Expense[];

  // Campos legados (mantidos para compatibilidade, mas não usados na nova lógica de array)
  maintenanceDescription?: string;
  maintenanceCost?: number;
  maintenanceDate?: string; 
  fuelCost?: number;
  fuelDate?: string; 
}

export interface AdminUser {
  username: string;
  password: string;
}