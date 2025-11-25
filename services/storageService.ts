import { TrackingData, Coordinates, AdminUser, Driver } from '../types';
import { createClient } from '@supabase/supabase-js';

// --- CONFIGURAÇÃO DO SUPABASE (BANCO NA NUVEM) ---
// Para ativar a sincronização entre dispositivos:
// 1. Crie um projeto em https://supabase.com
// 2. Crie as tabelas: 'shipments', 'drivers', 'users' com colunas (id/code text PK, data jsonb)
// 3. Cole a URL e a KEY abaixo.

const SUPABASE_URL = ''; // Ex: https://xyz.supabase.co
const SUPABASE_ANON_KEY = ''; // Ex: eyJhbGciOiJIUzI1NiIsInR5...

// Inicializa cliente apenas se as chaves existirem
const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY) 
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) 
  : null;

const STORAGE_KEY = 'rodovar_shipments_db_v1';
const USERS_KEY = 'rodovar_users_db_v1';
const DRIVERS_KEY = 'rodovar_drivers_db_v1';

// --- HELPERS DE FALLBACK (LOCAL STORAGE) ---
const getLocal = <T>(key: string): T[] | Record<string, T> => {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : (key === STORAGE_KEY ? {} : []);
};
const saveLocal = (key: string, data: any) => localStorage.setItem(key, JSON.stringify(data));

// --- AUTH SERVICE (ADMIN) ---

const initUsers = () => {
  const users = localStorage.getItem(USERS_KEY);
  if (!users) {
    const defaultUser: AdminUser = { username: 'admin', password: 'txhfpb6xcj#@123' };
    localStorage.setItem(USERS_KEY, JSON.stringify([defaultUser]));
  }
};

export const getAllUsers = async (): Promise<AdminUser[]> => {
  // Tenta Cloud
  if (supabase) {
      try {
          const { data, error } = await supabase.from('users').select('*');
          if (!error && data) return data.map((row: any) => row.data);
      } catch (e) { console.error("Erro Cloud Users:", e); }
  }
  
  // Fallback Local
  initUsers();
  const users = localStorage.getItem(USERS_KEY);
  return users ? JSON.parse(users) : [];
};

export const saveUser = async (user: AdminUser): Promise<boolean> => {
  const users = await getAllUsers();
  if (users.some(u => u.username === user.username)) {
    return false;
  }

  // Cloud
  if (supabase) {
      await supabase.from('users').upsert({ username: user.username, data: user });
  }

  // Local
  users.push(user);
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
  return true;
};

export const deleteUser = async (username: string): Promise<void> => {
  let users = await getAllUsers();
  if (users.length <= 1) return; 
  
  // Cloud
  if (supabase) {
      await supabase.from('users').delete().eq('username', username);
  }

  // Local
  users = users.filter(u => u.username !== username);
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
};

export const validateLogin = async (user: AdminUser): Promise<boolean> => {
  const users = await getAllUsers();
  return users.some(u => u.username === user.username && u.password === user.password);
};

// --- DRIVER SERVICE ---

export const getAllDrivers = async (): Promise<Driver[]> => {
  // Cloud
  if (supabase) {
      try {
        const { data, error } = await supabase.from('drivers').select('*');
        if (!error && data) return data.map((row: any) => row.data);
      } catch (e) { console.error("Erro Cloud Drivers:", e); }
  }

  // Local
  const drivers = localStorage.getItem(DRIVERS_KEY);
  return drivers ? JSON.parse(drivers) : [];
};

export const saveDriver = async (driver: Driver): Promise<boolean> => {
  const drivers = await getAllDrivers();
  // Check duplication by name (simple check)
  if (drivers.some(d => d.name.toLowerCase() === driver.name.toLowerCase() && d.id !== driver.id)) {
     return false;
  }

  // Cloud
  if (supabase) {
      await supabase.from('drivers').upsert({ id: driver.id, data: driver });
  }

  // Local (Update or Push)
  const index = drivers.findIndex(d => d.id === driver.id);
  if (index >= 0) {
      drivers[index] = driver;
  } else {
      drivers.push(driver);
  }
  localStorage.setItem(DRIVERS_KEY, JSON.stringify(drivers));
  return true;
};

export const deleteDriver = async (id: string): Promise<void> => {
  // Cloud
  if (supabase) {
      await supabase.from('drivers').delete().eq('id', id);
  }

  // Local
  let drivers = await getAllDrivers();
  drivers = drivers.filter(d => d.id !== id);
  localStorage.setItem(DRIVERS_KEY, JSON.stringify(drivers));
};

export const validateDriverLogin = async (name: string, password: string): Promise<Driver | null> => {
    const drivers = await getAllDrivers();
    return drivers.find(d => d.name.toLowerCase() === name.toLowerCase() && d.password === password) || null;
};


// --- GEO & SHIPMENT SERVICE ---

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

export const getCoordinatesForString = async (locationString: string, detailedAddress?: string): Promise<Coordinates> => {
    try {
        let query = `${locationString}, Brazil`;
        if (detailedAddress && detailedAddress.length > 3) {
             query = `${detailedAddress}, ${locationString}, Brazil`;
        }

        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`);
        const data = await response.json();
        
        if (data && data.length > 0) {
          return {
            lat: parseFloat(data[0].lat),
            lng: parseFloat(data[0].lon)
          };
        } else if (detailedAddress) {
            return getCoordinatesForString(locationString);
        }

        return { lat: 0, lng: 0 }; 
    } catch (error) {
        return { lat: 0, lng: 0 };
    }
}

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
    if ((origin.lat === 0 && origin.lng === 0) || (destination.lat === 0 && destination.lng === 0)) {
        return 0;
    }
    const totalDistance = getDistanceFromLatLonInKm(origin.lat, origin.lng, destination.lat, destination.lng);
    const remainingDistance = getDistanceFromLatLonInKm(current.lat, current.lng, destination.lat, destination.lng);

    if (totalDistance <= 0.1) return 100;
    // Cálculo linear simples: (1 - restante/total) * 100
    let percentage = (1 - (remainingDistance / totalDistance)) * 100;
    
    if (percentage < 0) percentage = 0; 
    if (percentage > 100) percentage = 100; 

    return Math.round(percentage);
};

// --- CRUD SHIPMENTS (AGORA ASSÍNCRONO) ---

export const getAllShipments = async (): Promise<Record<string, TrackingData>> => {
  // Cloud
  if (supabase) {
      try {
        const { data, error } = await supabase.from('shipments').select('*');
        if (!error && data) {
            const cloudMap: Record<string, TrackingData> = {};
            data.forEach((row: any) => {
                cloudMap[row.code] = row.data;
            });
            return cloudMap;
        }
      } catch (e) { console.error("Erro Cloud Shipments:", e); }
  }

  // Local
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? JSON.parse(stored) : {};
};

export const saveShipment = async (data: TrackingData): Promise<void> => {
  // Cloud
  if (supabase) {
      await supabase.from('shipments').upsert({ code: data.code, data: data });
  }

  // Local
  const all = await getAllShipments(); 
  // Mas para garantir integridade local, vamos ler o local puro
  const localRaw = localStorage.getItem(STORAGE_KEY);
  const localData = localRaw ? JSON.parse(localRaw) : {};
  
  const updatedData = { ...localData, [data.code]: data };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedData));
};

export const getShipment = async (code: string): Promise<TrackingData | null> => {
  // Cloud Optimization: Tenta buscar direto 1 registro
  if (supabase) {
      try {
          const { data, error } = await supabase.from('shipments').select('*').eq('code', code).single();
          if (!error && data) return data.data;
      } catch (e) {}
  }

  const all = await getAllShipments();
  return all[code] || null;
};

// --- NOVO: BUSCAR CARGA POR TELEFONE DO MOTORISTA ---
export const getShipmentByDriverPhone = async (phone: string): Promise<TrackingData | null> => {
    // 1. Limpa o telefone de busca (remove espaços, traços, etc)
    const cleanSearch = phone.replace(/\D/g, '');
    
    // 2. Busca o motorista com esse telefone (verificando substrings para flexibilidade)
    const drivers = await getAllDrivers();
    const driver = drivers.find(d => {
        if (!d.phone) return false;
        const driverPhoneClean = d.phone.replace(/\D/g, '');
        // Verifica se contém o número (ex: digitou sem DDD mas tem no cadastro, ou vice-versa)
        return driverPhoneClean.includes(cleanSearch) || cleanSearch.includes(driverPhoneClean);
    });
    
    if (!driver) return null;

    // 3. Busca a carga ativa deste motorista
    const allShipments = await getAllShipments();
    const activeShipment = Object.values(allShipments).find(s => 
        s.driverId === driver.id && 
        s.status !== 'DELIVERED'
    );

    return activeShipment || null;
};

export const deleteShipment = async (code: string): Promise<void> => {
  // Cloud
  if (supabase) {
      await supabase.from('shipments').delete().eq('code', code);
  }

  // Local
  const localRaw = localStorage.getItem(STORAGE_KEY);
  const all = localRaw ? JSON.parse(localRaw) : {};
  delete all[code];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
};