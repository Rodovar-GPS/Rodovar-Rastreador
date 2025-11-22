import React, { useState, useEffect } from 'react';
import { TrackingData, TrackingStatus, Coordinates, StatusLabels, Expense } from '../types';
import { getShipment, saveShipment, getCoordinatesForString, calculateProgress } from '../services/storageService';
import MapVisualization from './MapVisualization';
import { TruckIcon } from './Icons';

interface DriverPanelProps {
  onClose: () => void;
}

const DriverPanel: React.FC<DriverPanelProps> = ({ onClose }) => {
  // --- AUTH STATES ---
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authUser, setAuthUser] = useState('');
  const [authPass, setAuthPass] = useState('');
  const [authError, setAuthError] = useState('');

  // --- SHIPMENT STATES ---
  const [code, setCode] = useState('');
  const [shipment, setShipment] = useState<TrackingData | null>(null);
  const [error, setError] = useState('');
  const [isLocating, setIsLocating] = useState(false);
  const [lastUpdateLog, setLastUpdateLog] = useState<string>('');
  const [showInvoice, setShowInvoice] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  // --- FORM STATES (DRIVER INPUTS) ---
  const [driverNotes, setDriverNotes] = useState('');
  
  // Novos Estados de Despesa (Lista)
  const [expenseCategory, setExpenseCategory] = useState<'Combustível' | 'Manutenção' | 'Alimentação' | 'Outros'>('Combustível');
  const [expenseDesc, setExpenseDesc] = useState('');
  const [expenseValue, setExpenseValue] = useState('');
  const [pendingExpenses, setPendingExpenses] = useState<Expense[]>([]);

  // Helper: Get formatted time string
  const getNowFormatted = () => {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes} - ${day}/${month}`;
  };

  const handleGatekeeperLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (authUser.toLowerCase() === 'rodovar' && authPass === 'motorista2026') {
        setIsAuthenticated(true);
        setAuthError('');
    } else {
        setAuthError('Credenciais de motorista inválidas.');
    }
  };

  const handleShipmentLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const found = getShipment(code.toUpperCase());
    if (found) {
        setShipment(found);
        // Load existing data
        setDriverNotes(found.driverNotes || '');
        setError('');
        setPendingExpenses([]); // Reset pending on load
    } else {
        setError('Carga não encontrada. Verifique o código.');
    }
  };

  const handleAddExpense = () => {
      if (!expenseValue || parseFloat(expenseValue) <= 0) {
          alert("Informe um valor válido.");
          return;
      }
      if (!expenseDesc) {
          alert("Informe uma descrição.");
          return;
      }

      const newExpense: Expense = {
          id: Date.now().toString(),
          category: expenseCategory,
          description: expenseDesc,
          value: parseFloat(expenseValue),
          date: new Date().toISOString()
      };

      setPendingExpenses([...pendingExpenses, newExpense]);
      setExpenseDesc('');
      setExpenseValue('');
  };

  const handleRemovePendingExpense = (id: string) => {
      setPendingExpenses(pendingExpenses.filter(e => e.id !== id));
  };

  // Função centralizada de atualização
  const performUpdate = async (forceCompletion = false) => {
      if (!navigator.geolocation) {
          throw new Error("Navegador sem suporte a GPS.");
      }

      return new Promise<void>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
              async (position) => {
                  try {
                      console.log("GPS Obtido:", position.coords);
                      const { latitude, longitude } = position.coords;
                      const currentCoords: Coordinates = { lat: latitude, lng: longitude };

                      // 1. Recuperar dados frescos do storage
                      const freshShipment = getShipment(code.toUpperCase());
                      if (!freshShipment) {
                          throw new Error("Sessão inválida. Carga não encontrada.");
                      }

                      // 2. Geocoding Reverso (Coords -> Endereço)
                      let city = freshShipment.currentLocation.city;
                      let state = freshShipment.currentLocation.state;
                      let address = freshShipment.currentLocation.address || '';

                      try {
                          const response = await fetch(
                              `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`
                          );
                          const data = await response.json();
                          
                          if (data && data.address) {
                              city = data.address.city || data.address.town || data.address.village || data.address.municipality || city;
                              state = data.address.state || state;
                              if (state.length > 2) state = state.substring(0, 2).toUpperCase();
                              
                              address = data.address.road 
                                  ? `${data.address.road}${data.address.house_number ? `, ${data.address.house_number}` : ''}` 
                                  : (data.display_name ? data.display_name.split(',')[0] : address);
                          }
                      } catch (geoErr) {
                          console.warn("Erro no Geocoding reverso:", geoErr);
                      }

                      // 3. Coordenadas de Destino & Progresso
                      let destCoords = freshShipment.destinationCoordinates;
                      if ((!destCoords || (destCoords.lat === 0 && destCoords.lng === 0)) && freshShipment.destination) {
                           destCoords = await getCoordinatesForString(freshShipment.destination);
                      }

                      let progress = freshShipment.progress || 0;
                      if (destCoords && freshShipment.origin) {
                           const originCoords = await getCoordinatesForString(freshShipment.origin);
                           progress = calculateProgress(originCoords, destCoords, currentCoords);
                      }
                      
                      // Lógica de Progresso e Conclusão
                      if (progress < 1) progress = 1;
                      if (forceCompletion) progress = 100;

                      // 4. Consolidar Despesas (Histórico Antigo + Novos Pendentes)
                      const currentExpenses = freshShipment.expenses || [];
                      // Se houver campos legados e nenhum expense array, converte-os (migração)
                      if (currentExpenses.length === 0 && (freshShipment.maintenanceCost || freshShipment.fuelCost)) {
                          if (freshShipment.maintenanceCost) {
                              currentExpenses.push({
                                  id: 'legacy-maint', category: 'Manutenção', 
                                  description: freshShipment.maintenanceDescription || 'Manutenção Anterior',
                                  value: freshShipment.maintenanceCost, date: freshShipment.maintenanceDate || new Date().toISOString()
                              });
                          }
                          if (freshShipment.fuelCost) {
                              currentExpenses.push({
                                  id: 'legacy-fuel', category: 'Combustível',
                                  description: 'Combustível Anterior',
                                  value: freshShipment.fuelCost, date: freshShipment.fuelDate || new Date().toISOString()
                              });
                          }
                      }

                      const updatedExpenses = [...currentExpenses, ...pendingExpenses];

                      // 5. Montar Objeto Atualizado
                      const updatedShipment: TrackingData = {
                          ...freshShipment,
                          status: forceCompletion ? TrackingStatus.DELIVERED : TrackingStatus.IN_TRANSIT,
                          currentLocation: {
                              city,
                              state,
                              address,
                              coordinates: currentCoords
                          },
                          destinationCoordinates: destCoords,
                          lastUpdate: getNowFormatted(),
                          progress: progress,
                          message: forceCompletion ? 'Entrega Realizada' : 'Em trânsito - Atualizado pelo Motorista',
                          
                          driverNotes: driverNotes,
                          expenses: updatedExpenses, // Salva o array completo
                          
                          // Limpa campos legados para evitar confusão futura
                          maintenanceCost: 0, fuelCost: 0
                      };

                      // 6. Salvar
                      saveShipment(updatedShipment);
                      setShipment(updatedShipment);
                      setPendingExpenses([]); // Limpa pendentes pois já foram salvos
                      setLastUpdateLog(forceCompletion ? `VIAGEM CONCLUÍDA às ${getNowFormatted()}` : `Atualizado: ${city} às ${getNowFormatted()}`);
                      resolve();

                  } catch (err: any) {
                      console.error("Erro no processamento:", err);
                      setLastUpdateLog(`Erro processamento: ${err.message}`);
                      reject(err);
                  }
              },
              (geoError) => {
                  console.error("Erro de Geolocalização:", geoError);
                  let msg = "Erro desconhecido de GPS.";
                  switch(geoError.code) {
                      case 1: msg = "Permissão de GPS Negada."; break;
                      case 2: msg = "Sinal de GPS indisponível."; break;
                      case 3: msg = "Tempo limite do GPS esgotado."; break;
                  }
                  setLastUpdateLog(msg);
                  reject(new Error(msg));
              },
              { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
          );
      });
  };

  const handleUpdateTrip = async () => {
      if (!window.isSecureContext && window.location.hostname !== 'localhost') {
          alert("Atenção: O rastreamento GPS requer conexão segura (HTTPS).");
      }
      
      const isReadyToComplete = shipment && shipment.progress >= 90;
      const actionText = isReadyToComplete ? "CONCLUIR VIAGEM" : "ATUALIZAR VIAGEM";

      if (isReadyToComplete && !confirm("Confirma a CONCLUSÃO DA VIAGEM? O status mudará para ENTREGUE.")) {
          return;
      }

      setIsLocating(true);
      try {
          await performUpdate(isReadyToComplete);
          if (isReadyToComplete) {
              alert("PARABÉNS! Viagem marcada como CONCLUÍDA e ENTREGUE.");
          } else {
              alert("Viagem atualizada com sucesso! Dados salvos.");
          }
      } catch (err: any) {
          alert(`ERRO AO ${actionText}:\n${err.message}`);
      } finally {
          setIsLocating(false);
      }
  };

  const handleDownloadPDF = () => {
    const element = document.getElementById('printable-invoice');
    if (!element || !shipment) return;

    setIsGeneratingPdf(true);

    // Configurações do html2pdf
    const opt = {
        margin:       5, // margem em mm
        filename:     `Comprovante_${shipment.code}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, logging: false },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    // Chamada da biblioteca (adicionada via script tag no index.html)
    const html2pdf = (window as any).html2pdf;
    
    if (html2pdf) {
        html2pdf().set(opt).from(element).save().then(() => {
            setIsGeneratingPdf(false);
        }).catch((err: any) => {
            console.error("Erro ao gerar PDF:", err);
            alert("Erro ao gerar o arquivo PDF. Tente novamente.");
            setIsGeneratingPdf(false);
        });
    } else {
        alert("Biblioteca de PDF não carregada. Verifique sua conexão.");
        setIsGeneratingPdf(false);
    }
  };

  // --- RENDER: GATEKEEPER (LOGIN) ---
  if (!isAuthenticated) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 animate-[fadeIn_0.3s]">
            <div className="w-full max-w-md bg-[#1E1E1E] border border-gray-700 rounded-xl p-6 md:p-8 shadow-2xl text-center">
                <div className="inline-block p-4 rounded-full bg-rodovar-yellow mb-4">
                    <TruckIcon className="w-8 h-8 text-black" />
                </div>
                <h2 className="text-2xl font-bold text-white">Acesso Motorista</h2>
                <p className="text-gray-400 text-sm mb-6">Faça login para acessar o painel de controle.</p>
                
                <form onSubmit={handleGatekeeperLogin} className="space-y-4">
                    <div>
                        <input 
                            type="text" 
                            value={authUser}
                            onChange={e => setAuthUser(e.target.value)}
                            placeholder="Login (Ex: Rodovar)"
                            className="w-full bg-black/50 border border-gray-600 rounded p-3 text-white focus:border-rodovar-yellow outline-none"
                        />
                    </div>
                    <div>
                        <input 
                            type="password" 
                            value={authPass}
                            onChange={e => setAuthPass(e.target.value)}
                            placeholder="Senha"
                            className="w-full bg-black/50 border border-gray-600 rounded p-3 text-white focus:border-rodovar-yellow outline-none"
                        />
                    </div>
                    
                    {authError && <p className="text-red-500 text-sm font-bold">{authError}</p>}

                    <div className="flex gap-2">
                        <button type="button" onClick={onClose} className="flex-1 bg-gray-800 text-white font-bold py-3 rounded hover:bg-gray-700">
                            CANCELAR
                        </button>
                        <button type="submit" className="flex-[2] bg-rodovar-yellow text-black font-bold py-3 rounded hover:bg-yellow-400">
                            ENTRAR
                        </button>
                    </div>
                </form>
            </div>
        </div>
      );
  }

  // --- RENDER: SHIPMENT SELECTOR ---
  if (!shipment) {
    return (
        <div className="w-full max-w-md mx-auto p-4 md:p-6 animate-[fadeIn_0.3s]">
            <div className="bg-[#1E1E1E] border border-rodovar-yellow/30 rounded-xl p-6 md:p-8 shadow-2xl text-center relative">
                <button onClick={() => setIsAuthenticated(false)} className="absolute top-4 right-4 text-gray-500 hover:text-white text-xs uppercase">
                    Sair
                </button>
                <h2 className="text-2xl font-bold text-white mb-2">Selecionar Carga</h2>
                <p className="text-gray-400 text-sm mb-6">Informe o código da carga para iniciar.</p>

                <form onSubmit={handleShipmentLogin} className="space-y-4">
                    <input 
                        type="text" 
                        value={code}
                        onChange={e => setCode(e.target.value.toUpperCase())}
                        placeholder="CÓDIGO (Ex: RODO-001)"
                        className="w-full bg-black/50 border border-gray-600 rounded-lg p-4 text-center text-xl text-white font-mono font-bold focus:border-rodovar-yellow outline-none uppercase tracking-widest"
                    />
                    {error && <p className="text-red-500 text-xs font-bold">{error}</p>}
                    
                    <button 
                        type="submit"
                        className="w-full bg-rodovar-yellow text-black font-bold py-3 rounded-lg hover:bg-yellow-400 shadow-[0_0_15px_rgba(255,215,0,0.2)]"
                    >
                        ACESSAR PAINEL
                    </button>
                </form>
            </div>
        </div>
    );
  }

  const isTripCompleted = shipment.status === TrackingStatus.DELIVERED;
  const isReadyToFinish = shipment.progress >= 90;

  // --- RENDER: MAIN COCKPIT ---
  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-4 md:py-6 flex flex-col pb-24 md:pb-20 animate-[fadeIn_0.5s]">
        
        {/* Header Motorista (Mobile Responsivo) */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 bg-[#1E1E1E] p-4 rounded-xl border border-gray-800 gap-4">
            <div>
                <h2 className="text-white font-bold text-lg flex items-center gap-2">
                    <span className="bg-rodovar-yellow text-black px-2 rounded text-sm">{shipment.code}</span>
                    <span className="">Painel de Viagem</span>
                </h2>
                <div className="text-xs text-gray-400 mt-1 flex items-center gap-2">
                    <span className="truncate max-w-[100px]">{shipment.origin}</span>
                    <span>➔</span>
                    <span className="truncate max-w-[100px]">{shipment.destination}</span>
                </div>
            </div>
            <div className="flex gap-2 w-full md:w-auto">
                <button onClick={() => setShowInvoice(true)} className="flex-1 md:flex-none text-xs font-bold bg-white text-black px-3 py-2 rounded hover:bg-gray-200 flex items-center justify-center gap-1 shadow-lg transition-transform hover:scale-105 active:scale-95">
                    📄 Nota Fiscal
                </button>
                <button onClick={() => setShipment(null)} className="flex-1 md:flex-none text-xs text-gray-500 hover:text-white border border-gray-700 px-3 py-2 rounded uppercase">
                    Trocar Carga
                </button>
            </div>
        </div>

        {/* LAYOUT GRID */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* COLUNA ESQUERDA: CONTROLES */}
            <div className="lg:col-span-1 flex flex-col gap-6 order-2 lg:order-1">
                
                {/* BOTÃO PRINCIPAL */}
                <div className="bg-[#1E1E1E] p-4 md:p-6 rounded-xl border border-gray-700 text-center shadow-xl">
                    <button 
                        onClick={handleUpdateTrip}
                        disabled={isLocating || isTripCompleted}
                        className={`w-full text-xl font-bold py-6 rounded-xl shadow-lg transition-transform active:scale-95 flex flex-col items-center justify-center gap-2 
                        ${isLocating || isTripCompleted ? 'opacity-70 cursor-not-allowed bg-gray-600' : 
                          isReadyToFinish ? 'bg-green-600 hover:bg-green-500 text-white shadow-[0_0_20px_rgba(34,197,94,0.3)]' : 
                          'bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_20px_rgba(37,99,235,0.3)]'}`}
                    >
                        {isLocating ? (
                            <>
                                <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                <span className="text-sm">PROCESSANDO...</span>
                            </>
                        ) : isTripCompleted ? (
                            <>
                                <TruckIcon className="w-8 h-8" />
                                VIAGEM JÁ CONCLUÍDA
                            </>
                        ) : isReadyToFinish ? (
                            <>
                                <span className="text-2xl">✅</span>
                                CONCLUIR VIAGEM
                            </>
                        ) : (
                            <>
                                <TruckIcon className="w-8 h-8" />
                                ATUALIZAR VIAGEM
                            </>
                        )}
                    </button>
                    <p className="text-[10px] text-gray-500 mt-2">
                        {isReadyToFinish ? 'Você chegou ao destino. Conclua a viagem.' : 'Salva GPS, Gastos e Observações.'}
                    </p>
                </div>

                {/* FORMULÁRIO FINANCEIRO (NOVO - LISTA DE ITENS) */}
                <div className="bg-[#1E1E1E] p-4 md:p-5 rounded-xl border border-gray-700 space-y-4">
                    <h3 className="text-rodovar-yellow text-sm font-bold uppercase border-b border-gray-800 pb-2">Lançamento de Despesas</h3>
                    
                    <div className="grid grid-cols-1 gap-3">
                        <div>
                            <label className="text-[10px] text-gray-400 uppercase font-bold">Tipo</label>
                            <select 
                                value={expenseCategory} 
                                onChange={e => setExpenseCategory(e.target.value as any)}
                                disabled={isTripCompleted}
                                className="w-full bg-black/40 border border-gray-600 rounded p-2 text-white text-sm outline-none"
                            >
                                <option value="Combustível">Combustível</option>
                                <option value="Manutenção">Manutenção</option>
                                <option value="Alimentação">Alimentação</option>
                                <option value="Outros">Outros</option>
                            </select>
                        </div>
                        
                        <div>
                            <label className="text-[10px] text-gray-400 uppercase font-bold">Descrição</label>
                            <input 
                                type="text" 
                                value={expenseDesc}
                                onChange={e => setExpenseDesc(e.target.value)}
                                placeholder="Ex: Diesel, Pneu, Almoço..."
                                disabled={isTripCompleted}
                                className="w-full bg-black/40 border border-gray-600 rounded p-2 text-white text-sm"
                            />
                        </div>

                        <div className="flex gap-2">
                            <div className="flex-1 relative">
                                <span className="absolute left-3 top-2 text-gray-500 text-sm">R$</span>
                                <input 
                                    type="number" 
                                    value={expenseValue}
                                    onChange={e => setExpenseValue(e.target.value)}
                                    placeholder="0.00"
                                    disabled={isTripCompleted}
                                    className="w-full bg-black/40 border border-gray-600 rounded p-2 pl-8 text-white text-sm"
                                />
                            </div>
                            <button 
                                onClick={handleAddExpense}
                                disabled={isTripCompleted}
                                className="bg-rodovar-yellow text-black font-bold px-4 rounded hover:bg-yellow-400 disabled:opacity-50 text-xl"
                            >
                                +
                            </button>
                        </div>
                    </div>

                    {/* Lista de Itens Pendentes */}
                    {pendingExpenses.length > 0 && (
                        <div className="mt-4 bg-black/30 rounded border border-gray-700 p-2">
                            <p className="text-[10px] text-blue-400 uppercase mb-2 font-bold">Itens a Adicionar (Pendente):</p>
                            <div className="space-y-1 max-h-32 overflow-y-auto">
                                {pendingExpenses.map(item => (
                                    <div key={item.id} className="flex justify-between items-center text-xs bg-gray-800 p-1.5 rounded">
                                        <span className="text-gray-300 truncate w-1/2">{item.description}</span>
                                        <span className="text-rodovar-yellow">R$ {item.value.toFixed(2)}</span>
                                        <button onClick={() => handleRemovePendingExpense(item.id)} className="text-red-500 font-bold px-2 py-1">✕</button>
                                    </div>
                                ))}
                            </div>
                            <div className="mt-2 text-right text-xs text-gray-500 border-t border-gray-700 pt-1">
                                Total Pendente: R$ {pendingExpenses.reduce((acc, cur) => acc + cur.value, 0).toFixed(2)}
                            </div>
                        </div>
                    )}

                    {/* Notas */}
                    <div className="space-y-2 pt-4 border-t border-gray-800">
                        <label className="text-xs text-gray-400 font-bold uppercase">📝 Notas / Ocorrências</label>
                        <textarea 
                            value={driverNotes}
                            onChange={e => setDriverNotes(e.target.value)}
                            disabled={isTripCompleted}
                            className="w-full bg-black/40 border border-gray-600 rounded p-2 text-white text-sm h-20 resize-none disabled:opacity-50"
                            placeholder="Escreva aqui..."
                        />
                    </div>
                </div>
            </div>

            {/* COLUNA DIREITA: MAPA (ÚNICO INSTANCE) */}
            {/* Order muda no mobile para ficar em cima, no desktop fica na direita */}
            <div className="lg:col-span-2 flex flex-col gap-6 order-1 lg:order-2">
                 
                 {/* MAPA OTIMIZADO: Altura variavel dependendo da tela */}
                 <div className="bg-[#1E1E1E] rounded-xl border border-gray-700 overflow-hidden relative h-[40vh] lg:h-[500px]">
                     <MapVisualization 
                        coordinates={shipment.currentLocation.coordinates}
                        destinationCoordinates={shipment.destinationCoordinates}
                        className="w-full h-full absolute inset-0"
                     />
                </div>
                
                {/* Log e Status */}
                <div className="bg-[#1E1E1E] p-5 rounded-xl border border-gray-700 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                         <p className="text-[10px] text-gray-500 uppercase mb-1">Última Localização</p>
                         <p className="text-white font-bold text-sm md:text-base">{shipment.currentLocation.city} - {shipment.currentLocation.state}</p>
                         <p className="text-xs text-gray-400">{shipment.currentLocation.address}</p>
                    </div>
                    <div>
                        <p className="text-[10px] text-gray-500 uppercase mb-1">Status do Sistema</p>
                        <p className={`text-xs font-mono ${lastUpdateLog.includes('Erro') ? 'text-red-400' : 'text-green-400'}`}>
                            {lastUpdateLog || "Aguardando atualização..."}
                        </p>
                        
                        <div className="mt-2">
                            <div className="flex justify-between text-[10px] text-gray-500 uppercase">
                                <span>Progresso</span>
                                <span>{shipment.progress}%</span>
                            </div>
                            <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden mt-1">
                                <div className={`h-full ${isTripCompleted ? 'bg-green-500' : 'bg-rodovar-yellow'}`} style={{ width: `${shipment.progress}%` }}></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        {/* --- MODAL DE NOTA FISCAL (RESPONSIVO) --- */}
        {showInvoice && (
            <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-start md:items-center justify-center p-0 md:p-4 overflow-y-auto print:p-0 print:static print:bg-white print:inset-auto print:block">
                <div className="bg-white text-black w-full min-h-screen md:min-h-0 md:h-auto max-w-3xl p-4 md:p-8 rounded-none md:rounded-lg shadow-2xl relative print:shadow-none print:w-full print:max-w-none print:h-auto print:rounded-none overflow-y-auto">
                    
                    <div className="flex justify-end mb-2 print:hidden">
                         <button 
                            onClick={() => setShowInvoice(false)}
                            className="text-gray-500 hover:text-red-600 font-bold px-3 py-1 border border-gray-300 rounded bg-gray-100"
                        >
                            FECHAR ✕
                        </button>
                    </div>

                    <div id="printable-invoice" className="space-y-6 text-black p-2 md:p-0">
                        {/* Cabeçalho */}
                        <div className="border-b-2 border-black pb-4 flex flex-col md:flex-row justify-between items-start gap-4">
                            <div>
                                <h1 className="text-2xl md:text-3xl font-extrabold tracking-tighter text-black">RODOVAR</h1>
                                <p className="text-xs md:text-sm font-bold uppercase text-black">Transportes e Logística LTDA</p>
                                <p className="text-[10px] text-black mt-1">CNPJ: 54.094.853/0001-69</p>
                            </div>
                            <div className="text-left md:text-right w-full md:w-auto">
                                <h2 className="text-lg md:text-xl font-bold text-black">COMPROVANTE</h2>
                                <p className="font-mono text-base md:text-lg text-black">{shipment.code}</p>
                                <p className="text-[10px] mt-1 text-black">Emissão: {new Date().toLocaleString()}</p>
                            </div>
                        </div>

                        {/* Detalhes da Rota */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8">
                            <div>
                                <h3 className="text-xs font-bold uppercase border-b border-gray-300 mb-2 text-black">Origem</h3>
                                <p className="font-bold text-base md:text-lg text-black">{shipment.origin}</p>
                            </div>
                            <div>
                                <h3 className="text-xs font-bold uppercase border-b border-gray-300 mb-2 text-black">Destino</h3>
                                <p className="font-bold text-base md:text-lg text-black">{shipment.destination}</p>
                                <p className="text-[10px] md:text-xs text-gray-600">{shipment.destinationAddress}</p>
                            </div>
                        </div>

                         {/* Status */}
                        <div className="bg-gray-100 p-3 md:p-4 rounded border border-gray-300">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                <div>
                                    <span className="text-[10px] font-bold uppercase text-gray-500">Status</span>
                                    <p className="font-bold text-black text-sm">{StatusLabels[shipment.status]}</p>
                                </div>
                                <div>
                                    <span className="text-[10px] font-bold uppercase text-gray-500">Local Atual</span>
                                    <p className="text-xs md:text-sm text-black">{shipment.currentLocation.city} - {shipment.currentLocation.state}</p>
                                </div>
                                <div className="col-span-2 md:col-span-1">
                                    <span className="text-[10px] font-bold uppercase text-gray-500">Atualização</span>
                                    <p className="text-xs md:text-sm text-black">{shipment.lastUpdate}</p>
                                </div>
                            </div>
                        </div>

                        {/* Financeiro (Lista Completa) - Com Scroll Horizontal no Mobile */}
                        <div>
                            <h3 className="font-bold uppercase text-sm mb-2 bg-black text-white px-2 py-1">Relatório de Despesas</h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left border border-gray-300 min-w-[500px] md:min-w-full">
                                    <thead>
                                        <tr className="bg-gray-100 border-b border-gray-300">
                                            <th className="p-2 border-r text-black w-24">Tipo</th>
                                            <th className="p-2 border-r text-black">Descrição</th>
                                            <th className="p-2 border-r text-black w-32">Data</th>
                                            <th className="p-2 text-right text-black w-28">Valor (R$)</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(!shipment.expenses || shipment.expenses.length === 0) ? (
                                             <tr>
                                                <td colSpan={4} className="p-4 text-center text-gray-500 italic">Nenhuma despesa lançada.</td>
                                             </tr>
                                        ) : (
                                            shipment.expenses.map((exp, idx) => (
                                                <tr key={exp.id || idx} className="border-b border-gray-200">
                                                    <td className="p-2 border-r font-bold text-black text-xs uppercase">{exp.category}</td>
                                                    <td className="p-2 border-r text-black">{exp.description}</td>
                                                    <td className="p-2 border-r text-black text-xs">
                                                        {new Date(exp.date).toLocaleString()}
                                                    </td>
                                                    <td className="p-2 text-right text-black">R$ {exp.value.toFixed(2)}</td>
                                                </tr>
                                            ))
                                        )}
                                        
                                        <tr className="bg-gray-50 font-bold border-t-2 border-black">
                                            <td className="p-2 text-right text-black uppercase" colSpan={3}>TOTAL GERAL</td>
                                            <td className="p-2 text-right text-black">
                                                R$ {(shipment.expenses?.reduce((acc, cur) => acc + cur.value, 0) || 0).toFixed(2)}
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Obs */}
                        <div>
                            <h3 className="text-xs font-bold uppercase mb-1 text-black">Observações do Motorista</h3>
                            <div className="border border-gray-300 p-3 min-h-[60px] text-sm bg-gray-50 italic text-black break-words">
                                {shipment.driverNotes || "Nenhuma observação registrada."}
                            </div>
                        </div>

                        {/* Assinaturas */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 pt-8 md:pt-12 mt-4 md:mt-8 border-t border-black">
                            <div className="text-center">
                                <div className="border-t border-black w-2/3 mx-auto mb-2"></div>
                                <p className="text-xs uppercase font-bold text-black">Assinatura do Motorista</p>
                            </div>
                            <div className="text-center hidden md:block">
                                <div className="border-t border-black w-2/3 mx-auto mb-2"></div>
                                <p className="text-xs uppercase font-bold text-black">Assinatura do Responsável</p>
                            </div>
                        </div>
                    </div>

                    <div className="mt-6 md:mt-8 flex justify-end gap-4 print:hidden pb-8 md:pb-0">
                        <button 
                            onClick={handleDownloadPDF} 
                            disabled={isGeneratingPdf}
                            className={`w-full md:w-auto bg-black text-white px-6 py-3 rounded font-bold hover:bg-gray-800 shadow-lg flex items-center justify-center gap-2 ${isGeneratingPdf ? 'opacity-70 cursor-wait' : 'animate-pulse'}`}
                        >
                            <span>{isGeneratingPdf ? '⏳' : '💾'}</span> 
                            {isGeneratingPdf ? 'GERANDO PDF...' : 'BAIXAR COMPROVANTE'}
                        </button>
                    </div>
                </div>
            </div>
        )}
    </div>
  );
};

export default DriverPanel;