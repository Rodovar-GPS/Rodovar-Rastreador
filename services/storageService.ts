import { TrackingData, Coordinates, AdminUser, Driver } from '../types';

const STORAGE_KEY = 'rodovar_shipments_db_v1';
const USERS_KEY = 'rodovar_users_db_v1';
const DRIVERS_KEY = 'rodovar_drivers_db_v1';

// --- AUTH SERVICE (ADMIN) ---

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
    return false;
  }
  users.push(user);
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
  return true;
};

export const deleteUser = (username: string): void => {
  let users = getAllUsers();
  if (users.length <= 1) return; 
  users = users.filter(u => u.username !== username);
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
};

export const validateLogin = (user: AdminUser): boolean => {
  const users = getAllUsers();
  return users.some(u => u.username === user.username && u.password === user.password);
};

// --- DRIVER SERVICE ---

export const getAllDrivers = (): Driver[] => {
  const drivers = localStorage.getItem(DRIVERS_KEY);
  return drivers ? JSON.parse(drivers) : [];
};

export const saveDriver = (driver: Driver): boolean => {
  const drivers = getAllDrivers();
  // Verifica duplicidade por nome (simplificado)
  if (drivers.some(d => d.name.toLowerCase() === driver.name.toLowerCase())) {
     return false;
  }
  drivers.push(driver);
  localStorage.setItem(DRIVERS_KEY, JSON.stringify(drivers));
  return true;
};

export const deleteDriver = (id: string): void => {
  let drivers = getAllDrivers();
  drivers = drivers.filter(d => d.id !== id);
  localStorage.setItem(DRIVERS_KEY, JSON.stringify(drivers));
};

export const validateDriverLogin = (name: string, password: string): Driver | null => {
    const drivers = getAllDrivers();
    // Busca insensível a maiúsculas/minúsculas para o nome
    return drivers.find(d => d.name.toLowerCase() === name.toLowerCase() && d.password === password) || null;
};


// --- GEO & SHIPMENT SERVICE ---

// Função auxiliar para buscar coordenadas reais baseadas na cidade (Nominatim)
export const getCoordinatesForCity = async (city: string, state: string): Promise<Coordinates> => {
  try {
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
    return { lat: -14.2350, lng: -51.9253 };
  } catch (error) {
    console.error("Erro ao buscar coordenadas:", error);
    return { lat: -14.2350, lng: -51.9253 };
  }
};

// ATUALIZADO: Busca inteligente. Tenta endereço completo primeiro, depois cai para cidade/estado.
export const getCoordinatesForString = async (locationString: string, detailedAddress?: string): Promise<Coordinates> => {
    try {
        let query = `${locationString}, Brazil`;
        
        // Se tiver endereço detalhado, tenta usar ele concatenado com a cidade para maior precisão
        if (detailedAddress && detailedAddress.length > 3) {
             query = `${detailedAddress}, ${locationString}, Brazil`;
        }

        console.log("Geocoding Query:", query); // Debug

        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
        const data = await response.json();
        
        if (data && data.length > 0) {
          return {
            lat: parseFloat(data[0].lat),
            lng: parseFloat(data[0].lon)
          };
        } else if (detailedAddress) {
            // Se falhou com endereço completo, tenta só com a cidade/local genérico (fallback)
            return getCoordinatesForString(locationString);
        }

        return { lat: 0, lng: 0 }; 
    } catch (error) {
        return { lat: 0, lng: 0 };
    }
}

// Exportada para uso no frontend (DriverPanel)
export function getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; 
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; 
  return d;
}

function deg2rad(deg: number) {
  return deg * (Math.PI / 180);
}

export const calculateProgress = (origin: Coordinates, destination: Coordinates, current: Coordinates): number => {
    // Se não tiver coordenadas válidas de origem ou destino, progresso é zero.
    if ((origin.lat === 0 && origin.lng === 0) || (destination.lat === 0 && destination.lng === 0)) {
        return 0;
    }

    const totalDistance = getDistanceFromLatLonInKm(origin.lat, origin.lng, destination.lat, destination.lng);
    const remainingDistance = getDistanceFromLatLonInKm(current.lat, current.lng, destination.lat, destination.lng);

    // Evita divisão por zero
    if (totalDistance <= 0.1) return 100;

    let percentage = (1 - (remainingDistance / totalDistance)) * 100;

    // Ajustes finos de limites
    if (percentage < 0) percentage = 0; 
    if (percentage > 100) percentage = 100; 

    // Removemos a trava de "remainingDistance < 5" para deixar o cálculo fluido até o fim.
    // A decisão de "Concluir" será feita pelo botão no Frontend baseada na distância real.

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