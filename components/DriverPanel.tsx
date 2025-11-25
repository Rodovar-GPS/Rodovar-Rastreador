import React, { useState, useEffect } from 'react';
import { TrackingData, TrackingStatus, Coordinates, StatusLabels, Expense, Driver } from '../types';
import { getShipment, saveShipment, getCoordinatesForString, calculateProgress, validateDriverLogin, getDistanceFromLatLonInKm } from '../services/storageService';
import MapVisualization from './MapVisualization';
import { TruckIcon, SteeringWheelIcon } from './Icons';

interface DriverPanelProps {
  onClose: () => void;
}

const DriverPanel: React.FC<DriverPanelProps> = ({ onClose }) => {
  // --- AUTH STATES ---
  const [currentDriver, setCurrentDriver] = useState<Driver | null>(null);
  
  const [authName, setAuthName] = useState('');
  const [authPass, setAuthPass] = useState('');
  const [authError, setAuthError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // --- SHIPMENT STATES ---
  const [code, setCode] = useState('');
  const [shipment, setShipment] = useState<TrackingData | null>(null);
  const [error, setError] = useState('');
  const [isLocating, setIsLocating] = useState(false);
  const [lastUpdateLog, setLastUpdateLog] = useState<string>('');
  const [showInvoice, setShowInvoice] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  
  const [remainingDistanceKm, setRemainingDistanceKm] = useState<number | null>(null);

  // --- FORM STATES (DRIVER INPUTS) ---
  const [driverNotes, setDriverNotes] = useState('');
  const [expenseCategory, setExpenseCategory] = useState<'Combustível' | 'Manutenção' | 'Alimentação' | 'Outros'>('Combustível');
  const [expenseDesc, setExpenseDesc] = useState('');
  const [expenseValue, setExpenseValue] = useState('');
  const [pendingExpenses, setPendingExpenses] = useState<Expense[]>([]);

  const getNowFormatted = () => {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes} - ${day}/${month}`;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    try {
        const driver = await validateDriverLogin(authName, authPass);
        if (driver) {
            setCurrentDriver(driver);
            setAuthError('');
        } else {
            setAuthError('Motorista não encontrado ou senha incorreta.');
        }
    } finally {
        setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
      setCurrentDriver(null);
      setShipment(null);
      setRemainingDistanceKm(null);
  };

  const updateDistanceCalc = (current: Coordinates, dest?: Coordinates) => {
      if (current && dest && (dest.lat !== 0 || dest.lng !== 0)) {
          const dist = getDistanceFromLatLonInKm(current.lat, current.lng, dest.lat, dest.lng);
          setRemainingDistanceKm(dist);
      } else {
          setRemainingDistanceKm(null);
      }
  };

  const handleShipmentLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLocating(true); // Reusing loader
    try {
        const found = await getShipment(code.toUpperCase());
        if (found) {
            setShipment(found);
            setDriverNotes(found.driverNotes || '');
            setError('');
            setPendingExpenses([]); 
            
            updateDistanceCalc(found.currentLocation.coordinates, found.destinationCoordinates);
        } else {
            setError('Carga não encontrada. Verifique o código.');
        }
    } finally {
        setIsLocating(false);
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

  const performUpdate = async (forceCompletion = false) => {
      if (!navigator.geolocation) {
          throw new Error("Navegador sem suporte a GPS.");
      }
      if (!currentDriver) throw new Error("Sessão expirada.");

      return new Promise<void>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
              async (position) => {
                  try {
                      console.log("GPS Obtido:", position.coords);
                      const { latitude, longitude } = position.coords;
                      const currentCoords: Coordinates = { lat: latitude, lng: longitude };

                      const freshShipment = await getShipment(code.toUpperCase());
                      if (!freshShipment) {
                          throw new Error("Carga não encontrada.");
                      }

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

                      let destCoords = freshShipment.destinationCoordinates;
                      if ((!destCoords || (destCoords.lat === 0 && destCoords.lng === 0)) && freshShipment.destination) {
                           destCoords = await getCoordinatesForString(freshShipment.destination, freshShipment.destinationAddress);
                      }

                      updateDistanceCalc(currentCoords, destCoords);

                      let progress = freshShipment.progress || 0;
                      if (destCoords && freshShipment.origin) {
                           const originCoords = await getCoordinatesForString(freshShipment.origin);
                           progress = calculateProgress(originCoords, destCoords, currentCoords);
                      }
                      
                      if (forceCompletion) progress = 100;

                      const updatedExpenses = [...(freshShipment.expenses || []), ...pendingExpenses];

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
                          lastUpdatedBy: currentDriver.name,
                          progress: progress,
                          message: forceCompletion ? 'Entrega Realizada' : `Atualizado por ${currentDriver.name}`,
                          
                          driverNotes: driverNotes,
                          expenses: updatedExpenses, 
                          
                          maintenanceCost: 0, fuelCost: 0
                      };

                      await saveShipment(updatedShipment);
                      setShipment(updatedShipment);
                      setPendingExpenses([]); 
                      setLastUpdateLog(forceCompletion ? `CONCLUÍDA por ${currentDriver.name}` : `Atualizado em ${city}`);
                      resolve();

                  } catch (err: any) {
                      console.error("Erro no processamento:", err);
                      setLastUpdateLog(`Erro: ${err.message}`);
                      reject(err);
                  }
              },
              (geoError) => {
                  reject(new Error("Erro de GPS. Verifique a permissão."));
              },
              { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
          );
      });
  };

  const isCloseEnoughToFinish = remainingDistanceKm !== null && remainingDistanceKm <= 1.0;
  const isTripCompleted = shipment?.status === TrackingStatus.DELIVERED;

  const handleUpdateTrip = async () => {
      if (isCloseEnoughToFinish && !isTripCompleted) {
          if (confirm("Você está no destino (menos de 1km). Deseja CONCLUIR A VIAGEM e marcar como ENTREGUE?")) {
              setIsLocating(true);
              try {
                  await performUpdate(true); 
                  alert("Viagem Concluída com Sucesso!");
              } catch (err: any) {
                  alert(`Erro: ${err.message}`);
              } finally {
                  setIsLocating(false);
              }
              return;
          }
      }

      setIsLocating(true);
      try {
          await performUpdate(false);
          alert("Dados Atualizados!");
      } catch (err: any) {
          alert(`Erro: ${err.message}`);
      } finally {
          setIsLocating(false);
      }
  };

  const handleDownloadPDF = () => {
    const element = document.getElementById('printable-invoice');
    if (!element) return;
    setIsGeneratingPdf(true);
    const opt = {
        margin: 5, filename: `Comprovante_${shipment?.code}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    (window as any).html2pdf().set(opt).from(element).save().then(() => setIsGeneratingPdf(false));
  };

  // --- LOGIN SCREEN ---
  if (!currentDriver) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 animate-[fadeIn_0.3s]">
            <div className="w-full max-w-md bg-[#1E1E1E] border border-gray-700 rounded-xl p-6 md:p-8 shadow-2xl text-center">
                <div className="inline-block p-4 rounded-full bg-rodovar-yellow mb-4">
                    <SteeringWheelIcon className="w-8 h-8 text-black" />
                </div>
                <h2 className="text-2xl font-bold text-white">Login do Motorista</h2>
                <p className="text-gray-400 text-sm mb-6">Entre com seu Nome e Sobrenome cadastrados.</p>
                
                <form onSubmit={handleLogin} className="space-y-4">
                    <input 
                        type="text" 
                        value={authName}
                        onChange={e => setAuthName(e.target.value)}
                        placeholder="Nome e Sobrenome"
                        className="w-full bg-black/50 border border-gray-600 rounded p-3 text-white focus:border-rodovar-yellow outline-none"
                    />
                    <input 
                        type="password" 
                        value={authPass}
                        onChange={e => setAuthPass(e.target.value)}
                        placeholder="Senha"
                        className="w-full bg-black/50 border border-gray-600 rounded p-3 text-white focus:border-rodovar-yellow outline-none"
                    />
                    
                    {authError && <p className="text-red-500 text-sm font-bold">{authError}</p>}

                    <div className="flex gap-2">
                        <button type="button" onClick={onClose} className="flex-1 bg-gray-800 text-white font-bold py-3 rounded hover:bg-gray-700">VOLTAR</button>
                        <button type="submit" disabled={isLoggingIn} className="flex-[2] bg-rodovar-yellow text-black font-bold py-3 rounded hover:bg-yellow-400 disabled:opacity-50">
                            {isLoggingIn ? 'ENTRANDO...' : 'ENTRAR'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
      );
  }

  // --- SEJA BEM VINDO (NOVO) / SHIPMENT SELECTOR ---
  if (!shipment) {
    return (
        <div className="w-full max-w-md mx-auto p-4 md:p-6 animate-[fadeIn_0.3s] flex flex-col items-center">
            
            {/* WELCOME BANNER */}
            <div className="w-full bg-rodovar-yellow rounded-xl p-6 text-center shadow-lg mb-6 relative overflow-hidden group">
                 <div className="absolute top-0 left-0 w-full h-1 bg-white/50"></div>
                 <SteeringWheelIcon className="w-12 h-12 text-black mx-auto mb-2 animate-pulse" />
                 <h2 className="text-xl text-black font-extrabold uppercase tracking-tight">SEJA BEM VINDO</h2>
                 <h1 className="text-2xl md:text-3xl text-black font-black mt-1">{currentDriver.name}</h1>
                 <p className="text-black/70 text-xs mt-2 font-bold uppercase tracking-widest">Motorista Rodovar</p>
            </div>

            <div className="w-full bg-[#1E1E1E] border border-gray-700 rounded-xl p-6 md:p-8 shadow-2xl text-center relative">
                <button onClick={handleLogout} className="absolute top-4 right-4 text-gray-500 hover:text-white text-xs uppercase">SAIR</button>
                <h2 className="text-xl font-bold text-white mb-2">Iniciar Viagem</h2>
                <p className="text-gray-400 text-sm mb-6">Digite o código da carga para começar.</p>

                <form onSubmit={handleShipmentLogin} className="space-y-4">
                    <input 
                        type="text" 
                        value={code}
                        onChange={e => setCode(e.target.value.toUpperCase())}
                        placeholder="CÓDIGO (Ex: RODO-001)"
                        className="w-full bg-black/50 border border-gray-600 rounded-lg p-4 text-center text-xl text-white font-mono font-bold focus:border-rodovar-yellow outline-none uppercase tracking-widest"
                    />
                    {error && <p className="text-red-500 text-xs font-bold">{error}</p>}
                    <button type="submit" disabled={isLocating} className="w-full bg-rodovar-yellow text-black font-bold py-3 rounded-lg hover:bg-yellow-400 shadow-[0_0_15px_rgba(255,215,0,0.2)] disabled:opacity-50">
                        {isLocating ? 'BUSCANDO...' : 'ACESSAR PAINEL'}
                    </button>
                </form>
            </div>
        </div>
    );
  }

  // --- MAIN COCKPIT ---
  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-4 md:py-6 flex flex-col pb-24 md:pb-20 animate-[fadeIn_0.5s]">
        
        {/* Header Logado */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 bg-[#1E1E1E] p-4 rounded-xl border border-gray-800 gap-4">
            <div className="flex items-center gap-3">
                 <div className="bg-gray-800 p-2 rounded-full">
                    <SteeringWheelIcon className="w-5 h-5 text-rodovar-yellow" />
                 </div>
                 <div>
                    <h2 className="text-white font-bold text-sm">Olá, {currentDriver.name}</h2>
                    <p className="text-xs text-gray-500">Operando Carga: <span className="text-rodovar-yellow font-mono">{shipment.code}</span></p>
                 </div>
            </div>
            <div className="flex gap-2 w-full md:w-auto">
                <button onClick={() => setShowInvoice(true)} className="flex-1 md:flex-none text-xs font-bold bg-white text-black px-3 py-2 rounded hover:bg-gray-200">📄 Nota Fiscal</button>
                <button onClick={() => setShipment(null)} className="flex-1 md:flex-none text-xs text-gray-500 hover:text-white border border-gray-700 px-3 py-2 rounded uppercase">Trocar Carga</button>
            </div>
        </div>

        {/* LAYOUT GRID */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 flex flex-col gap-6 order-2 lg:order-1">
                <div className="bg-[#1E1E1E] p-4 md:p-6 rounded-xl border border-gray-700 text-center shadow-xl">
                    <button 
                        onClick={handleUpdateTrip}
                        disabled={isLocating || isTripCompleted}
                        className={`w-full text-xl font-bold py-6 rounded-xl shadow-lg transition-transform active:scale-95 flex flex-col items-center justify-center gap-2 
                        ${isLocating || isTripCompleted ? 'opacity-70 cursor-not-allowed bg-gray-600' : 
                          isCloseEnoughToFinish ? 'bg-green-600 hover:bg-green-500 text-white animate-pulse' : 
                          'bg-blue-600 hover:bg-blue-500 text-white'}`}
                    >
                        {isLocating ? 'PROCESSANDO...' : isTripCompleted ? 'VIAGEM CONCLUÍDA' : isCloseEnoughToFinish ? 'CONCLUIR VIAGEM' : 'ATUALIZAR VIAGEM'}
                    </button>
                    <p className="text-[10px] text-gray-500 mt-2">
                        {isCloseEnoughToFinish && !isTripCompleted 
                            ? 'Você chegou ao destino! Clique para finalizar.' 
                            : 'Registra localização e despesas em seu nome.'}
                    </p>
                </div>

                <div className="bg-[#1E1E1E] p-4 md:p-5 rounded-xl border border-gray-700 space-y-4">
                    <h3 className="text-rodovar-yellow text-sm font-bold uppercase border-b border-gray-800 pb-2">Despesas</h3>
                    <div className="grid grid-cols-1 gap-3">
                        <select value={expenseCategory} onChange={e => setExpenseCategory(e.target.value as any)} disabled={isTripCompleted} className="w-full bg-black/40 border border-gray-600 rounded p-2 text-white text-sm">
                            <option value="Combustível">Combustível</option>
                            <option value="Manutenção">Manutenção</option>
                            <option value="Alimentação">Alimentação</option>
                            <option value="Outros">Outros</option>
                        </select>
                        <input value={expenseDesc} onChange={e => setExpenseDesc(e.target.value)} placeholder="Descrição" disabled={isTripCompleted} className="w-full bg-black/40 border border-gray-600 rounded p-2 text-white text-sm" />
                        <div className="flex gap-2">
                            <input type="number" value={expenseValue} onChange={e => setExpenseValue(e.target.value)} placeholder="R$ 0.00" disabled={isTripCompleted} className="w-full bg-black/40 border border-gray-600 rounded p-2 text-white text-sm" />
                            <button onClick={handleAddExpense} disabled={isTripCompleted} className="bg-rodovar-yellow text-black font-bold px-4 rounded text-xl">+</button>
                        </div>
                    </div>
                    {pendingExpenses.length > 0 && (
                        <div className="mt-4 bg-black/30 rounded border border-gray-700 p-2 text-xs">
                            <p className="text-blue-400 font-bold mb-1">Pendentes de Salvar:</p>
                            {pendingExpenses.map(item => (
                                <div key={item.id} className="flex justify-between border-b border-gray-800 py-1">
                                    <span className="text-gray-300">{item.description}</span>
                                    <span>R$ {item.value} <button onClick={() => handleRemovePendingExpense(item.id)} className="text-red-500 ml-1">x</button></span>
                                </div>
                            ))}
                        </div>
                    )}
                    <textarea value={driverNotes} onChange={e => setDriverNotes(e.target.value)} disabled={isTripCompleted} className="w-full bg-black/40 border border-gray-600 rounded p-2 text-white text-sm h-20 resize-none mt-2" placeholder="Observações..." />
                </div>
            </div>

            <div className="lg:col-span-2 flex flex-col gap-6 order-1 lg:order-2">
                 <div className="bg-[#1E1E1E] rounded-xl border border-gray-700 overflow-hidden relative h-[40vh] lg:h-[500px]">
                     <MapVisualization 
                        coordinates={shipment.currentLocation.coordinates}
                        destinationCoordinates={shipment.destinationCoordinates}
                        className="w-full h-full absolute inset-0"
                     />
                </div>
                <div className="bg-[#1E1E1E] p-5 rounded-xl border border-gray-700 grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                         <p className="text-[10px] text-gray-500 uppercase mb-1">Última Localização</p>
                         <p className="text-white font-bold text-sm md:text-base">{shipment.currentLocation.city} - {shipment.currentLocation.state}</p>
                    </div>
                    <div className="border-l border-gray-800 pl-4">
                         <p className="text-[10px] text-gray-500 uppercase mb-1">Distância até o Destino</p>
                         <p className="text-rodovar-yellow font-bold text-lg md:text-xl">
                            {remainingDistanceKm !== null 
                                ? (remainingDistanceKm < 1 ? `${(remainingDistanceKm * 1000).toFixed(0)} metros` : `${remainingDistanceKm.toFixed(1)} km`)
                                : '--'
                            }
                         </p>
                    </div>
                    <div className="border-l border-gray-800 pl-4">
                        <p className="text-[10px] text-gray-500 uppercase mb-1">Status</p>
                        <p className={`text-xs font-mono ${lastUpdateLog.includes('Erro') ? 'text-red-400' : 'text-green-400'}`}>{lastUpdateLog || "Pronto para atualizar"}</p>
                    </div>
                </div>
            </div>
        </div>

        {/* MODAL NOTA FISCAL (COMPLETO) */}
        {showInvoice && (
            <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
                <div className="bg-white !text-black w-full max-w-3xl p-8 rounded shadow-2xl relative h-auto max-h-[90vh] overflow-y-auto">
                    <button onClick={() => setShowInvoice(false)} className="absolute top-4 right-4 font-bold text-gray-500">FECHAR X</button>
                    <div id="printable-invoice" className="space-y-6 !text-black">
                        <div className="border-b-2 border-black pb-4 flex justify-between">
                            <div><h1 className="text-3xl font-black text-black">RODOVAR</h1><p className="text-xs text-black">LOGÍSTICA LTDA</p></div>
                            <div className="text-right"><h2 className="text-xl font-bold text-black">COMPROVANTE</h2><p className="text-black">{shipment.code}</p></div>
                        </div>
                        <div className="grid grid-cols-2 gap-8">
                            <div><h3 className="font-bold border-b border-gray-300 text-black">ORIGEM</h3><p className="text-black">{shipment.origin}</p></div>
                            <div><h3 className="font-bold border-b border-gray-300 text-black">DESTINO</h3><p className="text-black">{shipment.destination}</p><p className="text-xs text-black">{shipment.destinationAddress}</p></div>
                        </div>
                        <div>
                             <h3 className="font-bold bg-black text-white px-2">MOTORISTA RESPONSÁVEL</h3>
                             <p className="p-2 border border-gray-300 font-bold text-black">{currentDriver.name}</p>
                        </div>
                        <table className="w-full text-sm border border-gray-300 !text-black">
                            <thead><tr className="bg-gray-100"><th className="p-2 text-left text-black">DESPESA</th><th className="p-2 text-right text-black">VALOR</th></tr></thead>
                            <tbody>
                                {shipment.expenses?.map((e, i) => <tr key={i} className="border-b"><td className="p-2 text-black">{e.description}</td><td className="p-2 text-right text-black">R$ {e.value.toFixed(2)}</td></tr>)}
                                <tr className="font-bold bg-gray-50"><td className="p-2 text-right text-black">TOTAL</td><td className="p-2 text-right text-black">R$ {shipment.expenses?.reduce((a, b) => a + b.value, 0).toFixed(2)}</td></tr>
                            </tbody>
                        </table>
                        <div className="mt-8 pt-8 border-t border-black grid grid-cols-2 gap-12 text-center text-xs font-bold uppercase text-black">
                            <div><div className="border-t border-black w-2/3 mx-auto mb-2"></div>{currentDriver.name}</div>
                            <div><div className="border-t border-black w-2/3 mx-auto mb-2"></div>RODOVAR LOGÍSTICA</div>
                        </div>
                    </div>
                    <div className="mt-8 text-right">
                        <button onClick={handleDownloadPDF} disabled={isGeneratingPdf} className="bg-black text-white px-6 py-3 rounded font-bold hover:bg-gray-800">{isGeneratingPdf ? 'GERANDO...' : 'BAIXAR PDF'}</button>
                    </div>
                </div>
            </div>
        )}
    </div>
  );
};

export default DriverPanel;