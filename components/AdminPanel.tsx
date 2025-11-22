import React, { useState, useEffect } from 'react';
import { TrackingData, TrackingStatus, StatusLabels, AdminUser } from '../types';
import { 
    saveShipment, getAllShipments, deleteShipment, 
    getCoordinatesForCity, getCoordinatesForString, calculateProgress,
    saveUser, getAllUsers, deleteUser
} from '../services/storageService';
import { TruckIcon, MapPinIcon } from './Icons';

interface AdminPanelProps {
  onClose: () => void;
  currentUser: string;
}

type Tab = 'shipments' | 'users';

const AdminPanel: React.FC<AdminPanelProps> = ({ onClose, currentUser }) => {
  const [activeTab, setActiveTab] = useState<Tab>('shipments');

  // --- HELPER: DATES ---
  const getNowFormatted = () => {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes} - ${day}/${month}/${year}`;
  };

  const getFutureDateFormatted = (daysToAdd: number) => {
    const date = new Date();
    date.setDate(date.getDate() + daysToAdd);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  };

  // --- STATES FOR SHIPMENTS ---
  const [shipments, setShipments] = useState<Record<string, TrackingData>>({});
  const [loading, setLoading] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false); // State for GPS button
  const [isEditing, setIsEditing] = useState(false); // Track if we are editing or creating

  const [code, setCode] = useState('');
  const [status, setStatus] = useState<TrackingStatus>(TrackingStatus.IN_TRANSIT);
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [address, setAddress] = useState('');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [destinationAddress, setDestinationAddress] = useState('');
  const [message, setMessage] = useState('Carga em deslocamento para o destino.');
  const [notes, setNotes] = useState('');
  
  // Dados Financeiros (Read-only ou preservados no edit)
  const [driverNotes, setDriverNotes] = useState('');
  const [maintDesc, setMaintDesc] = useState('');
  const [maintCost, setMaintCost] = useState(0);
  const [fuelCost, setFuelCost] = useState(0);
  const [fuelDate, setFuelDate] = useState('');
  
  // Inicializa com datas dinâmicas
  const [estimatedDate, setEstimatedDate] = useState(getFutureDateFormatted(3));
  const [updateTime, setUpdateTime] = useState(getNowFormatted());
  
  const [displayProgress, setDisplayProgress] = useState(0);

  // --- STATES FOR USERS ---
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [userMsg, setUserMsg] = useState('');

  useEffect(() => {
    loadShipments();
    loadUsers();
  }, []);

  // Auto-generate code when shipments are loaded and not editing
  useEffect(() => {
    if (!isEditing && Object.keys(shipments).length >= 0) {
        const nextCode = generateNextCode(shipments);
        setCode(nextCode);
        
        // Reset dynamic fields for new entry
        setUpdateTime(getNowFormatted());
        setEstimatedDate(getFutureDateFormatted(3));
    }
  }, [shipments, isEditing]);

  const loadShipments = () => {
    setShipments(getAllShipments());
  };

  const loadUsers = () => {
    setUsers(getAllUsers());
  };

  // --- HELPER: GENERATE CODE ---
  const generateNextCode = (currentShipments: Record<string, TrackingData>): string => {
    const keys = Object.keys(currentShipments);
    let maxId = 0;
    
    keys.forEach(k => {
        // Regex para encontrar padrão RODO-XXX ou RODOXXX
        const match = k.match(/RODO-?(\d+)/);
        if (match && match[1]) {
            const num = parseInt(match[1], 10);
            if (num > maxId) maxId = num;
        }
    });

    const nextId = maxId + 1;
    // Formata como RODO-001, RODO-002, etc.
    return `RODO-${String(nextId).padStart(3, '0')}`;
  };

  const resetForm = () => {
      setIsEditing(false);
      setStatus(TrackingStatus.IN_TRANSIT);
      setCity('');
      setState('');
      setAddress('');
      setOrigin('');
      setDestination('');
      setDestinationAddress('');
      setMessage('Carga em deslocamento para o destino.');
      setNotes('');
      setDisplayProgress(0);
      
      // Reset finance fields
      setDriverNotes('');
      setMaintDesc('');
      setMaintCost(0);
      setFuelCost(0);
      setFuelDate('');
  };

  // --- HANDLER: GPS LOCATION ---
  const handleGetDriverLocation = () => {
    if (!navigator.geolocation) {
        alert("Geolocalização não suportada pelo seu navegador.");
        return;
    }

    setGpsLoading(true);

    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const { latitude, longitude } = position.coords;
            try {
                // Reverse Geocode to fill the form
                const response = await fetch(
                    `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`
                );
                const data = await response.json();

                if (data && data.address) {
                    const foundCity = data.address.city || data.address.town || data.address.village || data.address.municipality || '';
                    const foundState = data.address.state || '';
                    // Try to shorten state if possible, otherwise use full name
                    const stateCode = foundState.length > 2 ? foundState.substring(0, 2).toUpperCase() : foundState; 
                    
                    const foundAddress = data.address.road 
                        ? `${data.address.road}${data.address.house_number ? `, ${data.address.house_number}` : ''}` 
                        : (data.display_name ? data.display_name.split(',')[0] : '');

                    setCity(foundCity);
                    setState(foundState); // Keeping full state name is safer for display, usually user edits to UF
                    setAddress(foundAddress);
                    setUpdateTime(getNowFormatted()); // Update time since we just got location
                } else {
                    alert("Endereço não encontrado para estas coordenadas.");
                }
            } catch (error) {
                console.error("Erro ao buscar endereço:", error);
                alert("Erro ao converter coordenadas em endereço.");
            } finally {
                setGpsLoading(false);
            }
        },
        (error) => {
            console.error("Erro de GPS:", error);
            setGpsLoading(false);
            alert("Não foi possível obter sua localização. Verifique se o GPS está ativo.");
        },
        { enableHighAccuracy: true }
    );
  };

  // --- HANDLERS FOR SHIPMENTS ---
  const handleSaveShipment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || !city || !state || !origin || !destination) {
      alert("Preencha Código, Cidade Atual, Estado, Origem e Destino para o cálculo automático.");
      return;
    }

    setLoading(true);

    try {
        const currentCoords = await getCoordinatesForCity(city, state);
        const originCoords = await getCoordinatesForString(origin);
        const destCoords = await getCoordinatesForString(destination);
        const calculatedProgress = calculateProgress(originCoords, destCoords, currentCoords);
        setDisplayProgress(calculatedProgress);

        const newData: TrackingData = {
            code: code.toUpperCase(),
            status,
            currentLocation: {
                city,
                state: state.toUpperCase(),
                address,
                coordinates: currentCoords
            },
            origin,
            destination,
            destinationAddress,
            destinationCoordinates: destCoords, 
            lastUpdate: updateTime,
            estimatedDelivery: estimatedDate,
            message,
            notes,
            progress: calculatedProgress,
            
            // Preserve driver data if editing, or initialize
            driverNotes,
            maintenanceDescription: maintDesc,
            maintenanceCost: maintCost,
            fuelCost: fuelCost,
            fuelDate: fuelDate
        };

        saveShipment(newData);
        loadShipments();
        alert(`Carga ${code} salva com sucesso!`);
        
        if (!isEditing) {
            resetForm();
        }
    } catch (err) {
        console.error(err);
        alert("Erro ao calcular rotas.");
    } finally {
        setLoading(false);
    }
  };

  const handleEditShipment = (data: TrackingData) => {
    setIsEditing(true);
    setCode(data.code);
    setStatus(data.status);
    setCity(data.currentLocation.city);
    setState(data.currentLocation.state);
    setAddress(data.currentLocation.address || '');
    setOrigin(data.origin);
    setDestination(data.destination);
    setDestinationAddress(data.destinationAddress || '');
    setMessage(data.message);
    setNotes(data.notes || '');
    setDisplayProgress(data.progress);
    setEstimatedDate(data.estimatedDelivery);
    setUpdateTime(getNowFormatted());
    
    // Load financial/driver data
    setDriverNotes(data.driverNotes || '');
    setMaintDesc(data.maintenanceDescription || '');
    setMaintCost(data.maintenanceCost || 0);
    setFuelCost(data.fuelCost || 0);
    setFuelDate(data.fuelDate || '');

    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
      resetForm();
  };

  const handleDeleteShipment = (codeToDelete: string) => {
    if (confirm(`Excluir a carga ${codeToDelete}?`)) {
      deleteShipment(codeToDelete);
      loadShipments();
      if (code === codeToDelete) resetForm();
    }
  };

  // --- HANDLERS FOR USERS ---
  const handleSaveUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername || !newPassword) return;
    
    const success = saveUser({ username: newUsername, password: newPassword });
    if (success) {
        setNewUsername('');
        setNewPassword('');
        setUserMsg('Usuário cadastrado com sucesso!');
        loadUsers();
        setTimeout(() => setUserMsg(''), 3000);
    } else {
        setUserMsg('Erro: Usuário já existe.');
    }
  };

  const handleDeleteUser = (username: string) => {
      if (confirm(`Remover acesso de ${username}?`)) {
          deleteUser(username);
          loadUsers();
      }
  };

  const isAdmin = currentUser === 'admin';

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-4 md:py-8 animate-[fadeIn_0.5s]">
      
      {/* Header / Tabs */}
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 md:mb-8 gap-4">
        <div className="text-center md:text-left">
            <h2 className="text-2xl md:text-3xl font-bold text-white">Painel Administrativo</h2>
            <p className="text-gray-500 text-xs md:text-sm">Sistema de Gestão RODOVAR</p>
        </div>
        
        <div className="flex flex-wrap justify-center gap-2 bg-[#1E1E1E] p-1 rounded-lg border border-gray-700 w-full md:w-auto">
            <button 
                onClick={() => setActiveTab('shipments')}
                className={`flex-1 md:flex-none px-4 py-2 rounded-md text-xs md:text-sm font-bold transition-all ${activeTab === 'shipments' ? 'bg-rodovar-yellow text-black shadow' : 'text-gray-400 hover:text-white'}`}
            >
                GERIR CARGAS
            </button>
            <button 
                onClick={() => setActiveTab('users')}
                className={`flex-1 md:flex-none px-4 py-2 rounded-md text-xs md:text-sm font-bold transition-all ${activeTab === 'users' ? 'bg-rodovar-yellow text-black shadow' : 'text-gray-400 hover:text-white'}`}
            >
                USUÁRIOS
            </button>
        </div>

        <button onClick={onClose} className="w-full md:w-auto text-red-400 hover:text-red-300 text-xs md:text-sm font-bold border border-red-900/50 bg-red-900/10 px-4 py-2 rounded hover:bg-red-900/20 transition-colors">
          SAIR / LOGOUT
        </button>
      </div>

      {/* CONTENT: SHIPMENTS */}
      {activeTab === 'shipments' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 md:gap-8">
            
            {/* FORMULÁRIO (Lado Esquerdo / Topo) */}
            <div className="xl:col-span-5 bg-[#1E1E1E] rounded-xl border border-gray-700 shadow-xl overflow-hidden relative">
                <div className="bg-gray-900/50 border-b border-gray-700 p-4 flex justify-between items-center">
                    <h3 className="text-base md:text-lg font-bold text-white flex items-center gap-2">
                        <span className="bg-rodovar-yellow text-black p-1 rounded text-xs">
                           <TruckIcon className="w-3 h-3 md:w-4 md:h-4" />
                        </span>
                        {isEditing ? `Editando: ${code}` : 'Nova Carga'}
                    </h3>
                    {isEditing ? (
                         <button onClick={handleCancelEdit} className="text-[10px] md:text-xs text-red-400 hover:text-red-300 border border-red-900 bg-red-900/20 px-2 py-1 rounded">
                             Cancelar
                         </button>
                    ) : (
                        <div className="text-[10px] text-gray-500">Código automático</div>
                    )}
                </div>
                
                <form onSubmit={handleSaveShipment} className="p-4 md:p-6 space-y-6">
                    
                    {/* Seção 1: Identificação */}
                    <div className="space-y-4">
                        <h4 className="text-rodovar-yellow text-xs uppercase font-bold tracking-widest border-b border-gray-800 pb-1">
                            1. Identificação
                        </h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Código</label>
                                <input 
                                    value={code} 
                                    readOnly={true}
                                    className="w-full bg-[#0a0a0a] border border-gray-700 rounded-lg px-4 py-2.5 text-rodovar-yellow font-mono font-bold outline-none cursor-not-allowed opacity-80 text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Status Atual</label>
                                <select 
                                    value={status} 
                                    onChange={e => setStatus(e.target.value as TrackingStatus)}
                                    className="w-full bg-[#121212] border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:border-rodovar-yellow outline-none appearance-none text-sm"
                                >
                                    {Object.entries(StatusLabels).map(([key, label]) => (
                                    <option key={key} value={key}>{label}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Seção 2: Rastreamento */}
                    <div className="space-y-4">
                        <div className="flex justify-between items-end border-b border-gray-800 pb-1">
                            <h4 className="text-rodovar-yellow text-xs uppercase font-bold tracking-widest">
                                2. Localização
                            </h4>
                            <button
                                type="button"
                                onClick={handleGetDriverLocation}
                                disabled={gpsLoading}
                                className="flex items-center gap-2 text-[10px] bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded-full transition-all shadow-[0_0_10px_rgba(37,99,235,0.3)]"
                            >
                                {gpsLoading ? 'BUSCANDO...' : 'USAR MEU GPS'}
                            </button>
                        </div>

                        <div className="bg-gray-900/30 p-3 md:p-4 rounded-lg border border-gray-800 space-y-3">
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Ponto de Referência</label>
                                <input 
                                    value={address} 
                                    onChange={e => setAddress(e.target.value)} 
                                    className="w-full bg-[#121212] border border-gray-700 rounded-lg p-2.5 text-white text-sm" 
                                    placeholder="Ex: Posto Graal" 
                                />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div className="sm:col-span-2">
                                    <label className="block text-xs text-gray-400 mb-1">Cidade</label>
                                    <input 
                                        value={city} 
                                        onChange={e => setCity(e.target.value)} 
                                        className="w-full bg-[#121212] border border-gray-700 rounded-lg p-2.5 text-white text-sm" 
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-400 mb-1">Estado</label>
                                    <input 
                                        value={state} 
                                        onChange={e => setState(e.target.value)} 
                                        className="w-full bg-[#121212] border border-gray-700 rounded-lg p-2.5 text-white text-sm" 
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Seção 3: Logística */}
                    <div className="space-y-4">
                        <h4 className="text-rodovar-yellow text-xs uppercase font-bold tracking-widest border-b border-gray-800 pb-1">
                            3. Rota
                        </h4>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Origem</label>
                                <input 
                                    value={origin} 
                                    onChange={e => setOrigin(e.target.value)} 
                                    className="w-full bg-[#121212] border border-gray-700 rounded-lg p-2.5 text-white text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Destino</label>
                                <input 
                                    value={destination} 
                                    onChange={e => setDestination(e.target.value)} 
                                    className="w-full bg-[#121212] border border-gray-700 rounded-lg p-2.5 text-white text-sm"
                                />
                            </div>
                        </div>
                         <div>
                            <label className="block text-xs text-gray-400 mb-1">Endereço Final</label>
                            <input 
                                value={destinationAddress} 
                                onChange={e => setDestinationAddress(e.target.value)} 
                                className="w-full bg-[#121212] border border-gray-700 rounded-lg p-2.5 text-white text-sm" 
                            />
                        </div>
                    </div>

                    {/* Seção 4: Informações */}
                    <div className="space-y-4">
                        <h4 className="text-rodovar-yellow text-xs uppercase font-bold tracking-widest border-b border-gray-800 pb-1">
                            4. Comunicação
                        </h4>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Status Rápido</label>
                            <input 
                                value={message} 
                                onChange={e => setMessage(e.target.value)} 
                                className="w-full bg-[#121212] border border-gray-700 rounded-lg p-2.5 text-white text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-400 mb-1">Notas Internas</label>
                            <textarea 
                                value={notes} 
                                onChange={e => setNotes(e.target.value)} 
                                className="w-full bg-[#121212] border border-gray-700 rounded-lg p-3 text-white text-sm h-20 resize-none" 
                            />
                        </div>
                    </div>

                    {/* Seção 5: Visualização do Motorista (Financeiro) */}
                    {isEditing && (
                        <div className="space-y-4 bg-black/20 p-4 rounded border border-gray-800">
                            <h4 className="text-blue-400 text-xs uppercase font-bold tracking-widest border-b border-blue-900/30 pb-1">
                                5. Dados Motorista
                            </h4>
                            <div className="grid grid-cols-2 gap-4 text-xs">
                                <div>
                                    <p className="text-gray-500 uppercase">Manutenção</p>
                                    <p className="text-white font-bold">{maintDesc || 'Nenhuma'}</p>
                                    <p className="text-rodovar-yellow">R$ {maintCost ? maintCost.toFixed(2) : '0.00'}</p>
                                </div>
                                <div>
                                    <p className="text-gray-500 uppercase">Abastecimento</p>
                                    <p className="text-white font-bold">{fuelDate ? new Date(fuelDate).toLocaleDateString() : '-'}</p>
                                    <p className="text-rodovar-yellow">R$ {fuelCost ? fuelCost.toFixed(2) : '0.00'}</p>
                                </div>
                            </div>
                            <div>
                                <p className="text-gray-500 uppercase text-xs">Notas do Motorista</p>
                                <p className="text-gray-300 text-sm italic border border-gray-700 p-2 rounded bg-black/40 mt-1 break-words">
                                    {driverNotes || 'Sem observações.'}
                                </p>
                            </div>
                        </div>
                    )}

                    <button 
                        type="submit" 
                        disabled={loading}
                        className={`w-full font-extrabold uppercase tracking-wider py-4 rounded-lg transition-all mt-4 text-sm md:text-base ${
                            isEditing 
                            ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-[0_0_20px_rgba(37,99,235,0.4)]'
                            : 'bg-gradient-to-r from-rodovar-yellow to-yellow-500 text-black hover:shadow-[0_0_20px_rgba(255,215,0,0.4)]'
                        }`}
                    >
                        {loading ? 'Processando...' : isEditing ? 'SALVAR ALTERAÇÕES' : 'CADASTRAR CARGA'}
                    </button>
                </form>
            </div>

            {/* LISTA (Lado Direito) */}
            <div className="xl:col-span-7 space-y-4 md:space-y-6">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg md:text-xl font-bold text-white">
                        Cargas Ativas
                    </h3>
                    <div className="text-xs md:text-sm text-gray-400 bg-gray-800 px-3 py-1 rounded-full">
                        Total: {Object.keys(shipments).length}
                    </div>
                </div>
                
                <div className="grid gap-4 max-h-[600px] xl:max-h-[1200px] overflow-y-auto pr-2 scrollbar-thin">
                    {Object.values(shipments).length === 0 ? (
                        <div className="text-center py-20 bg-[#1E1E1E] rounded-xl border border-gray-800 border-dashed">
                            <TruckIcon className="w-12 h-12 text-gray-700 mx-auto mb-4" />
                            <p className="text-gray-500">Nenhuma carga cadastrada no momento.</p>
                        </div>
                    ) : (
                        (Object.values(shipments) as TrackingData[]).reverse().map((shipment) => (
                            <div key={shipment.code} className={`group bg-[#1E1E1E] p-4 md:p-5 rounded-xl border hover:border-rodovar-yellow/50 transition-all shadow-lg ${code === shipment.code && isEditing ? 'border-blue-500 ring-1 ring-blue-500/30' : 'border-gray-800'}`}>
                                <div className="flex justify-between items-start mb-3">
                                    <div className="flex items-center gap-2 md:gap-3">
                                        <span className="bg-gray-900 text-rodovar-yellow font-mono font-bold px-2 py-1 rounded border border-gray-700 text-xs md:text-sm">
                                            {shipment.code}
                                        </span>
                                        <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded border ${
                                            shipment.status === TrackingStatus.DELIVERED ? 'bg-green-900/30 text-green-400 border-green-900' : 
                                            shipment.status === TrackingStatus.STOPPED ? 'bg-orange-900/30 text-orange-400 border-orange-900' :
                                            'bg-blue-900/30 text-blue-400 border-blue-900'
                                        }`}>
                                            {StatusLabels[shipment.status]}
                                        </span>
                                    </div>
                                    
                                    {/* Buttons: Opacity 100 on mobile (default), 0 on LG screens (unless hover) */}
                                    <div className="flex gap-2 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                                        <button 
                                            onClick={() => handleEditShipment(shipment)} 
                                            className="p-1.5 md:p-2 bg-blue-600/20 text-blue-400 rounded hover:bg-blue-600 hover:text-white transition"
                                            title="Editar"
                                        >
                                            ✏️
                                        </button>
                                        <button 
                                            onClick={() => handleDeleteShipment(shipment.code)} 
                                            className="p-1.5 md:p-2 bg-red-600/20 text-red-400 rounded hover:bg-red-600 hover:text-white transition"
                                            title="Excluir"
                                        >
                                            🗑️
                                        </button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-4 mb-3">
                                    <div>
                                        <p className="text-[10px] text-gray-500 uppercase">Localização</p>
                                        <p className="text-white font-medium text-sm truncate">{shipment.currentLocation.city}, {shipment.currentLocation.state}</p>
                                    </div>
                                    <div>
                                         <p className="text-[10px] text-gray-500 uppercase">Rota</p>
                                         <div className="flex items-center gap-2 text-xs text-gray-300">
                                            <span className="truncate max-w-[80px]">{shipment.origin}</span>
                                            <span className="text-gray-600">➔</span>
                                            <span className="truncate max-w-[80px]">{shipment.destination}</span>
                                         </div>
                                    </div>
                                </div>
                                
                                {/* Indicador de que o motorista adicionou dados */}
                                {(shipment.maintenanceCost || 0) + (shipment.fuelCost || 0) > 0 && (
                                    <div className="mb-2 flex items-center gap-2 text-xs text-rodovar-yellow bg-yellow-900/20 p-1 rounded border border-yellow-900/50">
                                        <span>💰 Gastos Declarados: R$ {((shipment.maintenanceCost || 0) + (shipment.fuelCost || 0)).toFixed(2)}</span>
                                    </div>
                                )}

                                <div className="mt-3 pt-3 border-t border-gray-800 flex justify-between text-[10px] text-gray-500">
                                    <span>Atualizado: {shipment.lastUpdate}</span>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
      )}

      {/* CONTENT: USERS */}
      {activeTab === 'users' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
              {isAdmin ? (
                  <div className="bg-[#1E1E1E] p-6 rounded-xl border border-gray-700">
                      <h3 className="text-xl font-bold text-white mb-6">Cadastrar Novo Administrador</h3>
                      <form onSubmit={handleSaveUser} className="space-y-4">
                          <div>
                              <label className="block text-xs text-gray-500 uppercase mb-1">Nome de Usuário</label>
                              <input value={newUsername} onChange={e => setNewUsername(e.target.value)} className="w-full bg-black/50 border border-gray-600 rounded p-3 text-white focus:border-rodovar-yellow outline-none" placeholder="usuario.admin" />
                          </div>
                          <div>
                              <label className="block text-xs text-gray-500 uppercase mb-1">Senha de Acesso</label>
                              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="w-full bg-black/50 border border-gray-600 rounded p-3 text-white focus:border-rodovar-yellow outline-none" placeholder="******" />
                          </div>
                          
                          {userMsg && (
                              <p className={`text-sm font-bold ${userMsg.includes('Erro') ? 'text-red-500' : 'text-green-500'}`}>{userMsg}</p>
                          )}

                          <button type="submit" className="w-full bg-rodovar-yellow text-black font-bold py-3 rounded hover:bg-yellow-400 transition-colors">
                              CADASTRAR USUÁRIO
                          </button>
                      </form>
                  </div>
              ) : (
                  <div className="bg-[#1E1E1E] p-6 rounded-xl border border-gray-700 flex flex-col items-center justify-center text-center">
                       <div className="w-12 h-12 bg-red-900/30 text-red-500 rounded-full flex items-center justify-center mb-4 border border-red-900">
                            ✕
                       </div>
                       <h3 className="text-xl font-bold text-white mb-2">Acesso Restrito</h3>
                       <p className="text-gray-400 text-sm">Apenas o administrador principal (admin) pode criar ou remover outros usuários.</p>
                  </div>
              )}

              <div className="bg-[#1E1E1E] p-6 rounded-xl border border-gray-700">
                  <h3 className="text-xl font-bold text-white mb-6">Usuários do Sistema</h3>
                  <div className="space-y-2">
                      {users.map(u => (
                          <div key={u.username} className="flex justify-between items-center bg-black/30 p-3 rounded border border-gray-800">
                              <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 bg-gray-700 rounded-full flex items-center justify-center text-xs font-bold">
                                      {u.username.charAt(0).toUpperCase()}
                                  </div>
                                  <span className="text-gray-300 font-medium">{u.username}</span>
                                  {u.username === 'admin' && <span className="text-[10px] bg-rodovar-yellow text-black px-2 rounded font-bold">MASTER</span>}
                              </div>
                              {isAdmin && u.username !== 'admin' && (
                                <button 
                                    onClick={() => handleDeleteUser(u.username)}
                                    className="text-red-500 hover:text-red-400 text-xs uppercase font-bold"
                                >
                                    Remover
                                </button>
                              )}
                          </div>
                      ))}
                  </div>
              </div>
          </div>
      )}

    </div>
  );
};

export default AdminPanel;