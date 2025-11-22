import { TrackingData, Coordinates, AdminUser } from '../types';

const STORAGE_KEY = 'rodovar_shipments_db_v1';
const USERS_KEY = 'rodovar_users_db_v1';

// --- AUTH SERVICE ---

// Inicializa com usuário padrão se não existir
const initUsers = () => {
  const users = localStorage.getItem(USERS_KEY);
  if (!users) {
    const defaultUser: AdminUser = { username: 'admin', password: 'txhfpb6xcj#@123' };
    localStorage.setItem(USERS_KEY, JSON.stringify([defaultUser]));
  }
};

export const getAllUsers = (): AdminUser[] => {
  initUsers();
  const users = localStorage.getItem(USERS_KEY);
  return users ? JSON.parse(users) : [];
};

export const saveUser = (user: AdminUser): boolean => {
  const users = getAllUsers();
  if (users.some(u => u.username === user.username)) {
    return false; // Usuário já existe
  }
  users.push(user);
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
  return true;
};

export const deleteUser = (username: string): void => {
  let users = getAllUsers();
  // Impede deletar o último usuário ou o admin principal se desejar (opcional, aqui permite tudo menos esvaziar)
  if (users.length <= 1) return; 
  
  users = users.filter(u => u.username !== username);
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
};

export const validateLogin = (user: AdminUser): boolean => {
  const users = getAllUsers();
  return users.some(u => u.username === user.username && u.password === user.password);
};

// --- GEO & SHIPMENT SERVICE ---

// Função auxiliar para buscar coordenadas reais baseadas na cidade (Nominatim)
export const getCoordinatesForCity = async (city: string, state: string): Promise<Coordinates> => {
  try {
    // Limpa a string para melhor busca
    const cleanCity = city.trim();
    const cleanState = state.trim();
    
    const query = `${cleanCity}, ${cleanState}, Brazil`;
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
    const data = await response.json();
    
    if (data && data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon)
      };
    }
    // Fallback coordinates (Center of Brazil) if not found
    return { lat: -14.2350, lng: -51.9253 };
  } catch (error) {
    console.error("Erro ao buscar coordenadas:", error);
    return { lat: -14.2350, lng: -51.9253 };
  }
};

// Função para buscar coordenadas apenas pelo nome (usado para origem/destino se não tiver estado separado)
export const getCoordinatesForString = async (locationString: string): Promise<Coordinates> => {
    try {
        const query = `${locationString}, Brazil`;
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
        const data = await response.json();
        
        if (data && data.length > 0) {
          return {
            lat: parseFloat(data[0].lat),
            lng: parseFloat(data[0].lon)
          };
        }
        return { lat: 0, lng: 0 }; // Return 0 to indicate failure
    } catch (error) {
        return { lat: 0, lng: 0 };
    }
}

// Fórmula de Haversine para calcular distância em KM entre dois pontos
function getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in km
  return d;
}

function deg2rad(deg: number) {
  return deg * (Math.PI / 180);
}

export const calculateProgress = (origin: Coordinates, destination: Coordinates, current: Coordinates): number => {
    // Se não conseguiu achar as coordenadas, retorna 0 ou mantém o atual
    if ((origin.lat === 0 && origin.lng === 0) || (destination.lat === 0 && destination.lng === 0)) {
        return 0;
    }

    const totalDistance = getDistanceFromLatLonInKm(origin.lat, origin.lng, destination.lat, destination.lng);
    const remainingDistance = getDistanceFromLatLonInKm(current.lat, current.lng, destination.lat, destination.lng);

    if (totalDistance === 0) return 100; // Origem e destino iguais

    // Progresso = 1 - (Falta / Total)
    let percentage = (1 - (remainingDistance / totalDistance)) * 100;

    // Ajustes finos
    if (percentage < 0) percentage = 0; // Se estiver antes da origem (erro de GPS)
    if (percentage > 100) percentage = 100; // Se já passou ou chegou
    if (remainingDistance < 5) percentage = 100; // Margem de erro de 5km para considerar entregue

    return Math.round(percentage);
};

export const saveShipment = (data: TrackingData): void => {
  const existingData = getAllShipments();
  const updatedData = { ...existingData, [data.code]: data };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedData));
};

export const getShipment = (code: string): TrackingData | null => {
  const all = getAllShipments();
  return all[code] || null;
};

export const getAllShipments = (): Record<string, TrackingData> => {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? JSON.parse(stored) : {};
};

export const deleteShipment = (code: string): void => {
  const all = getAllShipments();
  delete all[code];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
};