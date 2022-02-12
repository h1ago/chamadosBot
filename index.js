process.env.NTBA_FIX_319 = 1;
process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';

let puppeteer = require('puppeteer');
const TelegramBot = require('node-telegram-bot-api');
const EventEmitter = require('events');
const inquirer = require('inquirer');

const TOKEN = process.env.TOKEN_TELEGRAM;
const bot = new TelegramBot( TOKEN, { polling: true } );


//Parâmetros de configurações
const URL = 'http://127.0.0.1/glpi';
const HIAGO_ID = process.env.MEU_ID;
const GRUPO_ID = process.env.GRUPO_ID;
const ID_TELEGRAM_PARA_ENVIO = GRUPO_ID;
const LOGIN_GLPI = process.env.LOGIN_GLPI;
const SENHA_GLPI = process.env.SENHA_GLPI;
const TEMPO_VERIFICAR_CHAMADOS = 50000;
const TEMPO_ENVIAR_CHAMADOS = 45000;
const TEMPO_LIMPAR_CHAMADOS = 1000 * 60 * 60 * 24; //A cada 24horas
const HGPV = "EMPRESA > UNIDADE";
const MATRIZ = "EMPRESA > MATRIZ";

//Inicializar eventos 
let ee = new EventEmitter();

//controle dos chamados
var chamadosEnviar = new Array();
let navegador;
let paginaWeb;
let entidades_escolhidas = new Array();
let intervaloVerificarChamados;
let intervaloEnviarChamados;
let intervaloLimparChamados;
let cont=0;
const data = new Date();
let dataExecucao = data.getDate() +"/02/2022 "+ data.getHours() +"h:"+ data.getMinutes() +"m  :";

inquirer
  .prompt([
    {
      type: 'checkbox',
      name: 'unidades',
      pageSize: 12,
      message: 'Escolha a(s) Unidade(s):',
      choices: [
        {name: 'HGPV', value:"EMPRESA > HGPV"},
        {name: 'MATRIZ', value:"EMPRESA > MATRIZ"}
      ],
    },
  ])
  .then(resposta => {
    entidades_escolhidas = resposta.unidades;
    abrirNavegador();
  });

async function abrirNavegador(){
  navegador = await puppeteer.launch({headless: true});
  paginaWeb = await navegador.newPage();

  
  try{
      await paginaWeb.goto(URL);
  } catch(e) {
    console.log("menssagem de erro: " + e);
      if(e == `Error: net::ERR_CONNECTION_TIMED_OUT at ${URL}`){ //Controle dos erros
        cont++;
        await reiniciarBot();
     } 
  }

  realizarLogin(paginaWeb);


  
  //Chamadas das funções
  //Foram pegas estas referências para quando o bot reiniciar não repetir a emissão de funções
  intervaloVerificarChamados = setInterval(function(){ 
      ee.emit('verificarChamados', paginaWeb); 
  }, TEMPO_VERIFICAR_CHAMADOS);

  intervaloEnviarChamados = setInterval(function(){ 
     ee.emit('enviar_chamados'); 
  }, TEMPO_ENVIAR_CHAMADOS);

  //limpar o array de chamados para evitar problemas
  intervaloLimparChamados = setInterval(function(){ 
     chamadosEnviar = [];
  }, TEMPO_LIMPAR_CHAMADOS);

}


async function realizarLogin(page){

  await page.type('#login_name', LOGIN_GLPI);
  await page.type('#login_password', SENHA_GLPI);
  await page.click('[type="submit"]');
  await page.waitForNavigation();

  await page.click('.profile-selector');
  await page.waitForSelector('#ui-id-2 > div.center > a');
  await page.click('#ui-id-2 > div.center > a');
  await page.waitForSelector('#tab_stats > tbody > tr > td:nth-child(1) > span:nth-child(1) > a');
  await page.click('#tab_stats > tbody > tr > td:nth-child(1) > span:nth-child(1) > a');
  await page.waitForSelector('select:nth-child(3)');
  await page.select('select:nth-child(3)', '1000');

  console.log(">>>>>>>>>>> SCRIPT EXECUTANDO...<<<<<<<<<<<<<\n");

}

//Transforma as linhas da tabela em objetos
async function linhasParaChamados(page){

  let objetosChamado = new Array();

  objetosChamado = await page.evaluate((objetosChamado) => {

    //Pega todas as linhas da tabela
    let linhas = document.querySelectorAll('#massformTicket > div > table > tbody > tr');

    //OS Itens são os chamados
    let chamadosAux = new Array();

    for(let i=0; i<linhas.length-1; i++){//Para não pegar a última coluna (-1)

      let chamado = new Object();
      chamado.id = linhas[i].getElementsByTagName('td')[1].innerText;

      //Cria o chamado em sí
      if(chamado.id != null){//Diferente de null para não pegar a primeira coluna
        chamado.titulo = linhas[i].getElementsByTagName('td')[2].innerText;
        chamado.entidade = linhas[i].getElementsByTagName('td')[3].innerText;
        chamado.data = linhas[i].getElementsByTagName('td')[5].innerText;
        chamado.requerente = linhas[i].getElementsByTagName('td')[7].innerText;
        chamado.enviado = false;
        chamadosAux.push(chamado); 
      }        
    }

    return chamadosAux;

  }, objetosChamado);

  return objetosChamado;

}

//Transefere os chamados para o array de chamados que devem ser enviados
function listarChamadosEnviar(chamados){

  chamados.forEach(function(chamado){
    let existe = false;
    for(i=0; i<chamadosEnviar.length; i++){
      if(chamado.id == chamadosEnviar[i].id)
        existe = true;

    }

    entidades_escolhidas.forEach(function(entidade_escolhida){
      if(!existe && chamado.entidade == entidade_escolhida)
      chamadosEnviar.push(chamado);
    });

  });
}

ee.on('verificarChamados', async function(page){
  let chamados = new Array();

  chamados = await linhasParaChamados(page);
  
  listarChamadosEnviar(chamados);

  try { //O DOM da página está desaparecendo e não consegui identificar o porquê. O bot vai ficar reiniciando quando isso acontecer.
    //Clica em pesquisar para atualizar a lista de chamados da página
    await page.click("input[type=submit]");

  } catch(e) {

    if(e.message == 'No node found for selector: input[type=submit]'){ //Controle dos erros
      cont++;
      await reiniciarBot();
     } else {
        await navegador.close();
     }

   }
  
  HUD(chamados);

});

async function reiniciarBot(){
  clearInterval(intervaloVerificarChamados);
  clearInterval(intervaloEnviarChamados);
  clearInterval(intervaloLimparChamados);
  await navegador.close();
  abrirNavegador();
}

ee.on('enviar_chamados', async function(){
    //Envia os alertas para o celular
    chamadosEnviar.forEach(function(chamado, index){
        
        if(chamado.enviado == false){
          bot.sendMessage(ID_TELEGRAM_PARA_ENVIO, "!!! Novo Chamado !!!\n"+
                                    "Data: "+chamado.data+"\n"+
                                    "Título: "+chamado.titulo+"\n"+
                                    "Entidade: "+chamado.entidade+"\n"+
                                    "Requerente: "+chamado.requerente
                                    );
          this[index].enviado = true;
        }
    }, chamadosEnviar); 

});


function HUD(chamados){

  process.stdout.write('\033c');
  var data = new Date();

  console.log("... Script está sendo executado");

  console.log("==============================");
  console.log("Data de execução do bot: " + dataExecucao);
  console.log("Entidade escolhida:");
  entidades_escolhidas.forEach(function(entidade, index){
    console.log(entidade);
  });
  console.log("============================== \n");

  console.log("==============================");
  console.log("Quantidade de erros: ["+cont+"]");
  console.log("============================== \n");

  console.log("==============================");
  console.log("Chamados enviados:");
  chamadosEnviar.forEach(function(chamado, index){
      if(chamado.enviado){
          console.log("[ID: "+ chamado.id+"] ");
      }
  });
  console.log("============================== \n");

  console.log("==============================");
  console.log("Chamados HGPV listado em " + data.getDate() +"/01/2022 "+ data.getHours() +"h:"+ data.getMinutes() +"m  :");
  chamados.forEach(function(chamado, index){
      if(chamado.entidade == HGPV){
        console.log("------------------------------");
          console.log("[ID: "+ chamado.id+"]");
          console.log("[Enviado: "+chamado.enviado+"]");
          console.log("------------------------------ \n");
      }
  });
  console.log("============================== \n");
  


}