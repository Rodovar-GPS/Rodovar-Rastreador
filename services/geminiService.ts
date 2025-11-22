import { TrackingData } from "../types";
import { getShipment, getCoordinatesForString } from "./storageService";

// Este serviço agora atua apenas como uma camada de abstração para o StorageService
// Garantindo que a regra de negócio "Só localizar se houver cadastro" seja respeitada.

export const fetchTrackingInfo = async (code: string): Promise<TrackingData> => {
  
  // Simula um pequeno delay de rede para feedback visual (loading spinner)
  await new Promise(resolve => setTimeout(resolve, 600));

  // 1. Buscar no banco de dados local (Área Administrativa)
  const localData = getShipment(code);
  
  if (localData) {
    // Correção Retroativa: Se a carga já existe mas não tem coords de destino salvas, busca agora.
    if (!localData.destinationCoordinates && localData.destination) {
        try {
            const destCoords = await getCoordinatesForString(localData.destination);
            return { ...localData, destinationCoordinates: destCoords };
        } catch (e) {
            // Se falhar, retorna sem coords de destino
            return localData;
        }
    }
    return localData;
  }

  // 2. Se não existir, lançar erro específico
  throw new Error("CÓDIGO NÃO ENCONTRADO: Verifique se a numeração está correta ou se a carga já foi cadastrada no sistema.");
};