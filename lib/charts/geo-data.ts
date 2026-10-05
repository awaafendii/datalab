// Généré par scripts/geo-referentiel.mjs — ne pas modifier à la main.
//
// Sources : geoBoundaries 2017 (World Food Programme, OCHA ROWCA,
// Creative Commons Attribution 3.0 Intergovernmental Organisations (CC BY 3.0 IGO)) pour la Guinée ; fonds Plotly (Nations Unies)
// pour les pays.

export interface GeoZone {
  code: string;
  name: string;
  lat: number;
  lon: number;
  parent?: string;
}

export const GN_REGIONS: GeoZone[] = [
  {
    "code": "GN-B",
    "name": "Boké",
    "lat": 11.361,
    "lon": -13.754
  },
  {
    "code": "GN-C",
    "name": "Conakry",
    "lat": 9.626,
    "lon": -13.565
  },
  {
    "code": "GN-F",
    "name": "Faranah",
    "lat": 10.49,
    "lon": -10.659
  },
  {
    "code": "GN-K",
    "name": "Kankan",
    "lat": 10.584,
    "lon": -9.337
  },
  {
    "code": "GN-D",
    "name": "Kindia",
    "lat": 10.215,
    "lon": -13.119
  },
  {
    "code": "GN-L",
    "name": "Labé",
    "lat": 11.752,
    "lon": -12.015
  },
  {
    "code": "GN-M",
    "name": "Mamou",
    "lat": 10.669,
    "lon": -12.074
  },
  {
    "code": "GN-N",
    "name": "Nzérékoré",
    "lat": 8.439,
    "lon": -8.898
  }
];

export const GN_PREFECTURES: GeoZone[] = [
  {
    "code": "GN-BE",
    "name": "Beyla",
    "lat": 8.894,
    "lon": -8.332,
    "parent": "GN-N"
  },
  {
    "code": "GN-BF",
    "name": "Boffa",
    "lat": 10.374,
    "lon": -14.055,
    "parent": "GN-B"
  },
  {
    "code": "GN-BK",
    "name": "Boké",
    "lat": 11.089,
    "lon": -14.334,
    "parent": "GN-B"
  },
  {
    "code": "GN-C",
    "name": "Conakry",
    "lat": 9.626,
    "lon": -13.565,
    "parent": "GN-C"
  },
  {
    "code": "GN-CO",
    "name": "Coyah",
    "lat": 9.735,
    "lon": -13.317,
    "parent": "GN-D"
  },
  {
    "code": "GN-DB",
    "name": "Dabola",
    "lat": 10.73,
    "lon": -11.063,
    "parent": "GN-F"
  },
  {
    "code": "GN-DL",
    "name": "Dalaba",
    "lat": 10.913,
    "lon": -12.14,
    "parent": "GN-M"
  },
  {
    "code": "GN-DI",
    "name": "Dinguiraye",
    "lat": 11.608,
    "lon": -10.725,
    "parent": "GN-F"
  },
  {
    "code": "GN-DU",
    "name": "Dubréka",
    "lat": 10.121,
    "lon": -13.494,
    "parent": "GN-D"
  },
  {
    "code": "GN-FA",
    "name": "Faranah",
    "lat": 9.992,
    "lon": -10.739,
    "parent": "GN-F"
  },
  {
    "code": "GN-FO",
    "name": "Forécariah",
    "lat": 9.419,
    "lon": -13.056,
    "parent": "GN-D"
  },
  {
    "code": "GN-FR",
    "name": "Fria",
    "lat": 10.507,
    "lon": -13.587,
    "parent": "GN-B"
  },
  {
    "code": "GN-GA",
    "name": "Gaoual",
    "lat": 11.722,
    "lon": -13.352,
    "parent": "GN-B"
  },
  {
    "code": "GN-GU",
    "name": "Guéckédou",
    "lat": 8.698,
    "lon": -10.296,
    "parent": "GN-N"
  },
  {
    "code": "GN-KA",
    "name": "Kankan",
    "lat": 10.06,
    "lon": -9.108,
    "parent": "GN-K"
  },
  {
    "code": "GN-KE",
    "name": "Kérouané",
    "lat": 9.264,
    "lon": -9.105,
    "parent": "GN-K"
  },
  {
    "code": "GN-KD",
    "name": "Kindia",
    "lat": 10.096,
    "lon": -12.746,
    "parent": "GN-D"
  },
  {
    "code": "GN-KS",
    "name": "Kissidougou",
    "lat": 9.243,
    "lon": -10.027,
    "parent": "GN-F"
  },
  {
    "code": "GN-KB",
    "name": "Koubia",
    "lat": 11.775,
    "lon": -11.793,
    "parent": "GN-L"
  },
  {
    "code": "GN-KN",
    "name": "Koundara",
    "lat": 12.371,
    "lon": -13.198,
    "parent": "GN-B"
  },
  {
    "code": "GN-KO",
    "name": "Kouroussa",
    "lat": 10.582,
    "lon": -10.101,
    "parent": "GN-K"
  },
  {
    "code": "GN-LA",
    "name": "Labé",
    "lat": 11.382,
    "lon": -12.308,
    "parent": "GN-L"
  },
  {
    "code": "GN-LE",
    "name": "Lélouma",
    "lat": 11.5,
    "lon": -12.692,
    "parent": "GN-L"
  },
  {
    "code": "GN-LO",
    "name": "Lola",
    "lat": 7.985,
    "lon": -8.325,
    "parent": "GN-N"
  },
  {
    "code": "GN-MC",
    "name": "Macenta",
    "lat": 8.452,
    "lon": -9.342,
    "parent": "GN-N"
  },
  {
    "code": "GN-ML",
    "name": "Mali",
    "lat": 12.098,
    "lon": -12.173,
    "parent": "GN-L"
  },
  {
    "code": "GN-MM",
    "name": "Mamou",
    "lat": 10.493,
    "lon": -11.805,
    "parent": "GN-M"
  },
  {
    "code": "GN-MD",
    "name": "Mandiana",
    "lat": 10.759,
    "lon": -8.62,
    "parent": "GN-K"
  },
  {
    "code": "GN-NZ",
    "name": "Nzérékoré",
    "lat": 7.952,
    "lon": -8.796,
    "parent": "GN-N"
  },
  {
    "code": "GN-PI",
    "name": "Pita",
    "lat": 10.897,
    "lon": -12.636,
    "parent": "GN-M"
  },
  {
    "code": "GN-SI",
    "name": "Siguiri",
    "lat": 11.679,
    "lon": -9.473,
    "parent": "GN-K"
  },
  {
    "code": "GN-TE",
    "name": "Télimélé",
    "lat": 10.918,
    "lon": -13.362,
    "parent": "GN-D"
  },
  {
    "code": "GN-TO",
    "name": "Tougué",
    "lat": 11.501,
    "lon": -11.517,
    "parent": "GN-L"
  },
  {
    "code": "GN-YO",
    "name": "Yomou",
    "lat": 7.539,
    "lon": -9.11,
    "parent": "GN-N"
  }
];

// Centroïde [longitude, latitude] de chaque pays du fond de carte (ISO 3166-1 alpha-3).
export const COUNTRY_CENTROIDS: Record<string, [number, number]> = {"AFG":[66.03,33.84],"AGO":[17.57,-12.34],"ALA":[19.96,60.22],"ALB":[20.07,41.13],"ARE":[54.33,23.9],"ARG":[-65.15,-35.19],"ARM":[44.94,40.29],"AUT":[14.14,47.59],"AZE":[47.66,40.35],"BDI":[29.89,-3.37],"BEL":[4.67,50.64],"ATF":[69.52,-49.29],"BEN":[2.34,9.66],"BFA":[-1.74,12.28],"CZE":[15.32,49.74],"AUS":[134.35,-25.59],"BGD":[90.26,23.98],"BGR":[25.22,42.76],"BHS":[-78.05,24.69],"BIH":[17.78,44.18],"BLR":[28.06,53.54],"BLZ":[-88.7,17.2],"BOL":[-64.66,-16.71],"BRA":[-53.09,-10.78],"BRN":[114.61,4.5],"BTN":[90.44,27.39],"BWA":[23.81,-22.19],"CAF":[20.5,6.58],"CAN":[-101.67,57.72],"CHE":[8.23,46.8],"CHL":[-71.22,-35.2],"CHN":[103.87,36.63],"CIV":[-5.55,7.62],"CMR":[12.74,5.69],"COM":[43.36,-11.65],"COD":[23.65,-2.88],"COG":[15.22,-0.84],"COL":[-73.08,3.91],"MDA":[28.47,47.2],"CPV":[-23.64,15.09],"CRI":[-84.19,9.97],"CUB":[-78.96,21.61],"CYP":[33.14,35.03],"DEU":[10.37,51.09],"DJI":[42.58,11.74],"DMA":[-61.37,15.45],"DNK":[9.32,56.03],"DOM":[-70.5,18.9],"DZA":[2.68,28.16],"EGY":[29.77,26.57],"ERI":[38.8,15.4],"ESH":[-13.14,24.66],"EST":[25.83,58.68],"ETH":[39.63,8.63],"FIN":[26.3,64.54],"FLK":[-58.77,-51.76],"FRA":[2.45,46.63],"GUF":[-53.23,3.92],"GUM":[144.8,13.45],"GAB":[11.79,-0.61],"GBR":[-2.53,53.96],"GEO":[43.5,42.18],"GHA":[-1.2,7.97],"GIN":[-10.92,10.44],"GLP":[-61.59,16.19],"GMB":[-15.5,13.46],"GNB":[-14.93,12.05],"GNQ":[10.46,1.57],"GRC":[22.57,39.49],"GRL":[-41.33,74.78],"GTM":[-90.36,15.7],"GUY":[-58.97,4.78],"HND":[-86.61,14.82],"HRV":[16.43,45.13],"HTI":[-72.66,18.94],"HUN":[19.39,47.16],"IDN":[114,-0.19],"IRQ":[43.76,33.06],"ISL":[-18.63,64.99],"IND":[79.35,22.34],"IRL":[-8.13,53.18],"IRN":[54.3,32.57],"ISR":[34.97,31.38],"ITA":[12.15,43.53],"JAM":[-77.28,18.15],"JOR":[36.79,31.25],"JPN":[138,36.66],"KAZ":[67.3,48.16],"KEN":[37.86,0.54],"KGZ":[74.53,41.47],"KHM":[104.93,12.72],"KWT":[47.57,29.33],"MAR":[-6.27,31.85],"KOR":[127.86,36.48],"LAO":[103.76,18.51],"LBN":[35.89,33.92],"LBR":[-9.3,6.43],"LBY":[18.03,27.04],"LKA":[80.71,7.61],"LSO":[28.26,-29.58],"LTU":[23.88,55.34],"LUX":[6.08,49.77],"LVA":[24.93,56.85],"MDG":[46.69,-19.4],"MEX":[-102.53,23.94],"MKD":[21.69,41.61],"MLI":[-3.53,17.36],"MMR":[96.52,21.25],"MNE":[19.27,42.79],"MNG":[103.07,46.84],"WSM":[-172.43,-13.62],"MOZ":[35.55,-17.25],"MRT":[-10.34,20.26],"MTQ":[-61.02,14.65],"MWI":[34.31,-13.23],"MYS":[114.73,3.62],"NAM":[17.22,-22.14],"NCL":[165.5,-21.34],"NER":[9.4,17.42],"NGA":[8.1,9.59],"NIC":[-85.03,12.84],"NLD":[5.65,52.26],"NZL":[170.48,-43.99],"NOR":[14.02,64.28],"NPL":[83.93,28.26],"OMN":[56.1,20.58],"PAK":[68.8,29.38],"PAN":[-81.25,8.44],"PER":[-74.35,-9.18],"REU":[55.54,-21.13],"ROU":[24.98,45.84],"PHL":[121.4,15.98],"RWA":[29.91,-2],"SAU":[44.55,24.13],"PNG":[144.24,-6.6],"POL":[19.41,52.13],"PRI":[-66.47,18.22],"PRK":[127.18,40.14],"PRY":[-58.39,-23.24],"PYF":[-149.39,-17.7],"QAT":[51.2,25.28],"SDN":[29.95,16.01],"SEN":[-14.46,14.36],"SGS":[-36.64,-54.37],"SJM":[15.78,78.62],"SLB":[160.15,-9.62],"SLE":[-11.77,8.58],"SLV":[-88.87,13.74],"SOM":[45.87,6.05],"SRB":[20.8,44.04],"SSD":[30.32,7.31],"STP":[6.62,0.24],"SUR":[-55.9,4.13],"SVK":[19.49,48.72],"SVN":[14.8,46.1],"TWN":[120.97,23.75],"SWE":[16.73,62.85],"SWZ":[31.5,-26.57],"SYR":[38.49,35.02],"TCD":[18.66,15.36],"TGO":[0.98,8.52],"THA":[101.03,15.16],"TJK":[71.01,38.52],"TKM":[59.4,39.11],"TLS":[125.89,-8.82],"TTO":[-61.27,10.4],"TUN":[9.57,34.12],"TUR":[35.46,38.99],"TZA":[34.8,-6.27],"UGA":[32.39,1.28],"UKR":[31.4,49.01],"URY":[-56.02,-32.79],"UZB":[63.12,41.77],"VEN":[-66.17,7.12],"VNM":[106.31,16.63],"VUT":[166.86,-15.22],"YEM":[47.55,15.94],"ZAF":[25.09,-28.99],"ZMB":[27.79,-13.46],"ZWE":[29.88,-18.99],"PSE":[35.27,31.95],"ECU":[-91.16,-0.59],"ESP":[-16.54,28.28],"MUS":[57.57,-20.29],"PRT":[-16.99,32.75],"USA":[-99.11,39.52],"ATA":[21.36,-80.47],"FJI":[177.95,-17.84],"RUS":[99.15,61.66]};

// Pays du fond « Afrique ».
export const AFRICA_ISO3: string[] = ["AGO","ATF","BDI","BEN","BFA","BWA","CAF","CIV","CMR","COD","COG","COM","CPV","DJI","DZA","EGY","ERI","ESH","ETH","GAB","GHA","GIN","GMB","GNB","GNQ","KEN","LBR","LBY","LSO","MAR","MDG","MLI","MOZ","MRT","MUS","MWI","MYT","NAM","NER","NGA","REU","RWA","SDN","SEN","SHN","SLE","SOM","SSD","STP","SWZ","SYC","TCD","TGO","TUN","TZA","UGA","ZAF","ZMB","ZWE"];

// Mention courte affichée sous les cartes (attribution exigée par la licence).
export const GEO_SOURCE_GN = "Limites : OCHA ROWCA / PAM — geoBoundaries (CC BY 3.0 IGO)";
