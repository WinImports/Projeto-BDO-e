// Registro de módulos. A ordem aqui é a ordem das abas.
// Para incluir um novo módulo: crie o arquivo de definição e adicione-o na lista.
import bdo from './bdo.js';
import visitaTecnica from './visita-tecnica.js';
import handover from './handover.js';

export const MODULES = [bdo, visitaTecnica, handover];

export const getModule = (id) => MODULES.find((m) => m.id === id);
