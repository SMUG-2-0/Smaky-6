/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.c
  * @brief          : Main program body
  ******************************************************************************
  * @attention
  *
  * Copyright (c) 2025 STMicroelectronics.
  * All rights reserved.
  *
  * This software is licensed under terms that can be found in the LICENSE file
  * in the root directory of this software component.
  * If no LICENSE file comes with this software, it is provided AS-IS.
  *
  ******************************************************************************
  */

  // 15.10.2025 : début du projet sur carte STM32F446 (assemblée chez JLCPCB)
  // 22-23.10.2025 : Read - write ok avec "pulse" sur OE du transceiver.
  //                 (PCB à refaire avec un 74LVC8T245 + les 4 corrections)
  // ... 18.11.2025 : version fonctionnelle (avec toutes les PROM 74287)
  // ... 23.01.2026 : PCB avec carte micro-SD
  // ... 09.02.2026 : version pour carte, images SM6WIN1 à SM6WIN7.DSK
  ///... 13.02.2026 : version fonctionnelle avec SD

/* USER CODE END Header */
/* Includes ------------------------------------------------------------------*/
#include <string.h>
#include "main.h"
#include "fatfs.h"
#include "floppy.h"

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */

#include "lz4_decompress.h" // Disquette démo compressée
//#include "DxDemo.h"
//#include "DxGestion.h"
//#include "JDN2c.h"
//#include "Rodime.h"
//#include "DemoWin.h"
#include "MinDx.h"

/* USER CODE END Includes */

/* Private typedef -----------------------------------------------------------*/
/* USER CODE BEGIN PTD */

/* USER CODE END PTD */

/* Private define ------------------------------------------------------------*/
/* USER CODE BEGIN PD */

// #define GPIO_NOT_YET_READY GPIOD // ancienne carte
#define GPIO_NOT_YET_READY GPIOB // carte avec microSD (PD2 utilisé par SD)

/* USER CODE END PD */

/* Private macro -------------------------------------------------------------*/
/* USER CODE BEGIN PM */

/* USER CODE END PM */

/* Private variables ---------------------------------------------------------*/

SD_HandleTypeDef hsd;

/* USER CODE BEGIN PV */

volatile uint8_t dataMubusR[8];
volatile uint8_t dataMubusW[8];
volatile uint32_t ptDx;
volatile uint8_t WDcommand; // passage des commandes entre EXTI et main

uint8_t choix;
uint8_t *blocs;
FATFS fs;
char fileName[20] = "SM6WIN1.DSK";
uint8_t buffer[120000];

/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
void SystemClock_Config(void);
void static MX_GPIO_Init(void);
static void MX_SDIO_SD_Init(void);
/* USER CODE BEGIN PFP */

/* USER CODE END PFP */

/* Private user code ---------------------------------------------------------*/
/* USER CODE BEGIN 0 */

void AffLed(uint8_t val) {
  GPIOC->ODR = val;
}

void initRegWd1000() {
  for (uint32_t i=0; i<8; i++) {
    dataMubusR[i] = dataMubusW[i] = 0;
  }
  dataMubusR[7] = 0x50; // Seek Complete et Ready
  WDcommand = 0;
  ptDx = 0;
}

void GetDxA() {
	decompress_block(0, buffer, 32*1024);
	decompress_block(1, buffer+(32*1024), 32*1024);
	decompress_block(2, buffer+(64*1024), 32*1024);
	choix = 1;
	AffLed(choix);
}

void GetDxB() {
	for(uint32_t i=0; i<sizeof(minBlocs); i++){
		buffer[i] = minBlocs[i];
	}
	choix = 2;
	AffLed(choix);
}

#define IMAGE_SIZE (600 * 1024)
extern FIL floppyFile;
extern uint8_t floppyMounted;

void GetSd() {
  FRESULT e;
  fileName[6] = '0' | (choix>>2);
  uint32_t i;
  i = 3;
  while(i-- > 0){
    e = f_mount(&fs, SDPath, 1);
    if(e == FR_OK) {
	   e = InitFloppy(fileName);
	   if (e== FR_OK){
		 AffLed(choix);
		 return;
       }
    } else {
      Led7On;
      if (! HAL_GPIO_ReadPin(GPIOC,GPIO_PIN_14)) { // SD card insérée ?
    	  NVIC_SystemReset();
      }
    }
  }
  GetDxA(); // si la carte SD n'a pas pu être montée
}

void IncChoix() {
  choix &= 0b11100; // seulement les bits 2 à 4
  if (choix < 0b100) {
	choix = 0;
  }
  choix += 0b00100; // incrément les bits 4-3-2
  if (choix==0b100000) {
	choix = 0b11100;
  } // seulement 1 à 7 (pour SM6WIN1 à SM6WIN7.DSK)
}

void DecChoix() {
  choix &= 0b11100; // seulement les bits 2 à 4
  if (choix < 0b100) { // dx A ou B
    choix = 0;
  }
  choix -= 0b100; // décrémente les bits 4-3-2
  if (choix==0) { // seulement 1 à 7 (pour SM6WIN1 à SM6WIN7.DSK)
    choix = 0b00100;
  }
}

HAL_StatusTypeDef  HAL_InitTick(uint32_t TickPriority)
  {
	return HAL_OK;
  } // pas de sys tick

void HAL_Delay(uint32_t ms) // redéfinition du délai sans systick
{
    /* Ajuste ce facteur selon ta fréquence CPU */
    const uint32_t cycles_per_ms = SystemCoreClock / 8000;

    for (uint32_t i = 0; i < ms; i++)
    {
        for (volatile uint32_t j = 0; j < cycles_per_ms; j++)
        {
            __NOP();
        }
    }
}

/* USER CODE END 0 */

/**
  * @brief  The application entry point.
  * @retval int
  */
int main(void)
{
  /* USER CODE BEGIN 1 */

  /* USER CODE END 1 */

  /* MCU Configuration--------------------------------------------------------*/

  /* Reset of all peripherals, Initializes the Flash interface and the Systick. */
  HAL_Init();

  /* USER CODE BEGIN Init */

  SysTick->CTRL = 0;   // stoppe le timer et l’interruption

  /* USER CODE END Init */

  /* Configure the system clock */
  SystemClock_Config();

  /* USER CODE BEGIN SysInit */

  /* USER CODE END SysInit */

  /* Initialize all configured peripherals */

  MX_GPIO_Init();
  MX_SDIO_SD_Init();
  MX_FATFS_Init();

  /* USER CODE BEGIN 2 */
  HAL_GPIO_WritePin(GPIOC, GPIO_PIN_15, 0); // pour la détection de la SD card

  HAL_GPIO_WritePin(GPIOC, GPIO_PIN_13, 0); // OE off
  HAL_GPIO_WritePin(GPIO_NOT_YET_READY, GPIO_PIN_2, 0); // Prépare le NotYetReady

  GPIOB->BSRR = GPIO_BSRR_BR_9; // DIR data à 0
  // GPIO_NOT_YET_READY->MODER = 0b010000; // PD2 (PB2) en sortie, active NotYetReadyL, pas passé !

  /* USER CODE END 2 */

  /* Infinite loop */
  /* USER CODE BEGIN WHILE */
  floppyMounted = 0;
  initRegWd1000();

  // blocs = demoWinBlocs;
  // blocs = rodimeBlocs;

  blocs = buffer;
  choix = 0;
  IncChoix();
  GetSd();

  uint32_t t;
  while (1)
  {
    /* USER CODE END WHILE */

    /* USER CODE BEGIN 3 */
	  // ================================================================================
	  if (Pous1On) {
		if ((choix & 0b11111)!=1) { GetDxA(); } else { GetDxB(); }
		initRegWd1000();
		while(Pous1On) {HAL_Delay(10);}
	  } else if (Pous2On) {
		IncChoix();
		GetSd();
		initRegWd1000();
		while(Pous2On) {HAL_Delay(10);}
	  } else if (Pous3On) { // Pous3 : clear
		DecChoix();
		GetSd();
		initRegWd1000();
		while(Pous3On) {HAL_Delay(10);}
	  } else {
		// if ( (t++ & 0x3FFFF) ==0) { AffLed(dataMubusW[6]); } //Led8Toggle; }
		if ( ((t & 0x1F) == 0)  && ((choix&0b11111)>3) ){
		  AffLed(choix | 0b11100);
		} else {
		  AffLed(choix);
		}
		if ( (t++ & 0x3FFFF) ==0) { choix ^= (1<<7); }
	  }

	  // Interprétation des commandes :
	  //-------------------------------
	  // dataMubusR[7] = 0x50; // Status <- Seek Complete et Ready
	  // __WFI(); // on sort bien par une interruption autre que EXT ???
	  uint32_t bl;
      switch (WDcommand & 0xF0){ // command sur les 4 bits de poids forts
		case 0 : // pas de commande
			break;
		case 0x90 : // command Test
			WDcommand = 0; // la commande a été traitée
			// Led1On;
			dataMubusR[7] = 0x50; // Seek Complete et Ready
			break;
		case 0x10 : // command Restore
			initRegWd1000();
			WDcommand = 0; // la commande a été traitée
			// Led2On;
			dataMubusR[7] = 0x50; // Seek Complete et Ready
			break;
		case 0x70 : // command Seek
			WDcommand = 0; // la commande a été traitée
			// Led3On;
			dataMubusR[7] = 0x50; // Seek Complete et Ready
			break;
		case 0x20 : // command Read sector
			Led6On;
			ptDx = ((uint32_t)dataMubusW[3]) & 0x1F;
			ptDx += ( ((uint32_t)dataMubusW[6]) % 6) <<5;
			ptDx += ((uint32_t)dataMubusW[4]) * (6*32);
			if (choix < 3){
	      	  ptDx *= 256;
		    } else {
              bl = ptDx;
			  if (ReadBlocFloppy(bl, blocs) == FR_OK){
			  }
			  ptDx = 0;
		    }

	      	dataMubusR[0] = blocs[ptDx]; // first byte to read
	      	WDcommand = 0; // la commande a été traitée
	      	Led6Off;
			dataMubusR[7] = 0x50; // Status <- Seek Complete et Ready
	      	break;
		case 0x30 : // command Write Sector
			Led7On;
			if (choix < 3){
			  ptDx = ( (dataMubusW[3] & 0x1F) + ((dataMubusW[6] % 6) <<5) + (dataMubusW[4] * (6*32)) )* 256; //sector number + head
			} else {
			  ptDx = 0;
			  bl = (dataMubusW[3] & 0x1F) + ((dataMubusW[6] % 6) <<5) + (dataMubusW[4] * (6*32)); // pour la future écriture
			}
			WDcommand = 0; // la commande a été traitée
			// AffLed(~(ptDx>>8)); // <=============
			dataMubusR[7] = 0x50; // Status <- Seek Complete et Ready
			break;
		case 0x50 : // command Format track
			// pas nécessaire !
			dataMubusR[7] = 0x1; // Error
			WDcommand = 0; // la commande a été traitée
			// Led5On;
			break;
		case COM_FIN_WRITE : // écriture, après transfert des bytes du bloc
			WDcommand = 0; // la commande a été traitée
			if (choix >= 3){
			  if (WriteBlocFloppy(bl, blocs) == FR_OK){
			  }
			  ptDx = 0;
			  Led7Off;
			  dataMubusR[7] = 0x50; // Status <- Seek Complete et Ready
			}
			break;
		default: // ne devrait jamais arriver !
			// AffLed(WDcommand);
			// while(!Pous3On) {}
			dataMubusR[7] = 0x50; // Seek Complete et Ready
			// Led7On;
			WDcommand = 0; // la commande a été traitée
			break;
      }


	  // for (uint32_t i=0; i<8; i++) {
	  //  dataMubusR[i] = dataMubusW[i]+0x11;
	  // }
	  // ================================================================================
  }
  /* USER CODE END 3 */
}

/**
  * @brief System Clock Configuration
  * @retval None
  */
void SystemClock_Config0(void)
{
  RCC_OscInitTypeDef RCC_OscInitStruct = {0};
  RCC_ClkInitTypeDef RCC_ClkInitStruct = {0};

  /** Configure the main internal regulator output voltage
  */
  __HAL_RCC_PWR_CLK_ENABLE();
  __HAL_PWR_VOLTAGESCALING_CONFIG(PWR_REGULATOR_VOLTAGE_SCALE3);

  /** Initializes the RCC Oscillators according to the specified parameters
  * in the RCC_OscInitTypeDef structure.
  */
  RCC_OscInitStruct.OscillatorType = RCC_OSCILLATORTYPE_HSI;
  RCC_OscInitStruct.HSIState = RCC_HSI_ON;
  RCC_OscInitStruct.HSICalibrationValue = RCC_HSICALIBRATION_DEFAULT;
  RCC_OscInitStruct.PLL.PLLState = RCC_PLL_ON;
  RCC_OscInitStruct.PLL.PLLSource = RCC_PLLSOURCE_HSI;
  RCC_OscInitStruct.PLL.PLLM = 16;
  RCC_OscInitStruct.PLL.PLLN = 336;
  RCC_OscInitStruct.PLL.PLLP = RCC_PLLP_DIV4;
  RCC_OscInitStruct.PLL.PLLQ = 2;
  RCC_OscInitStruct.PLL.PLLR = 2;
  if (HAL_RCC_OscConfig(&RCC_OscInitStruct) != HAL_OK)
  {
    Error_Handler();
  }

  /** Initializes the CPU, AHB and APB buses clocks
  */
  RCC_ClkInitStruct.ClockType = RCC_CLOCKTYPE_HCLK|RCC_CLOCKTYPE_SYSCLK
                              |RCC_CLOCKTYPE_PCLK1|RCC_CLOCKTYPE_PCLK2;
  RCC_ClkInitStruct.SYSCLKSource = RCC_SYSCLKSOURCE_PLLCLK;
  RCC_ClkInitStruct.AHBCLKDivider = RCC_SYSCLK_DIV1;
  RCC_ClkInitStruct.APB1CLKDivider = RCC_HCLK_DIV2;
  RCC_ClkInitStruct.APB2CLKDivider = RCC_HCLK_DIV1;

  if (HAL_RCC_ClockConfig(&RCC_ClkInitStruct, FLASH_LATENCY_2) != HAL_OK)
  {
    Error_Handler();
  }
}

void SystemClock_Config(void) // version plus rapide :
{
  RCC_OscInitTypeDef RCC_OscInitStruct = {0};
  RCC_ClkInitTypeDef RCC_ClkInitStruct = {0};

  /** Configure the main internal regulator output voltage
  */
  __HAL_RCC_PWR_CLK_ENABLE();

  // Changement à SCALE1 pour permettre des fréquences plus élevées
  __HAL_PWR_VOLTAGESCALING_CONFIG(PWR_REGULATOR_VOLTAGE_SCALE1);

  /** Initializes the RCC Oscillators according to the specified parameters
  * in the RCC_OscInitTypeDef structure.
  */
  RCC_OscInitStruct.OscillatorType = RCC_OSCILLATORTYPE_HSI;
  RCC_OscInitStruct.HSIState = RCC_HSI_ON;
  RCC_OscInitStruct.HSICalibrationValue = RCC_HSICALIBRATION_DEFAULT;
  RCC_OscInitStruct.PLL.PLLState = RCC_PLL_ON;
  RCC_OscInitStruct.PLL.PLLSource = RCC_PLLSOURCE_HSI;
  RCC_OscInitStruct.PLL.PLLM = 8;        // Réduit de 16 à 8
  RCC_OscInitStruct.PLL.PLLN = 180;      // Ajusté pour atteindre 180 MHz
  RCC_OscInitStruct.PLL.PLLP = RCC_PLLP_DIV2;  // Division par 2 (plus rapide)
  RCC_OscInitStruct.PLL.PLLQ = 4;
  RCC_OscInitStruct.PLL.PLLR = 2;

  if (HAL_RCC_OscConfig(&RCC_OscInitStruct) != HAL_OK)
  {
    Error_Handler();
  }

  /** Initializes the CPU, AHB and APB buses clocks
  */
  RCC_ClkInitStruct.ClockType = RCC_CLOCKTYPE_HCLK|RCC_CLOCKTYPE_SYSCLK
                              |RCC_CLOCKTYPE_PCLK1|RCC_CLOCKTYPE_PCLK2;
  RCC_ClkInitStruct.SYSCLKSource = RCC_SYSCLKSOURCE_PLLCLK;
  RCC_ClkInitStruct.AHBCLKDivider = RCC_SYSCLK_DIV1;
  RCC_ClkInitStruct.APB1CLKDivider = RCC_HCLK_DIV2;
  RCC_ClkInitStruct.APB2CLKDivider = RCC_HCLK_DIV1;

  // Augmentation de la latence Flash pour supporter 180 MHz
  if (HAL_RCC_ClockConfig(&RCC_ClkInitStruct, FLASH_LATENCY_5) != HAL_OK)
  {
    Error_Handler();
  }
}


void static MX_GPIO_Init(void)
{
  GPIO_InitTypeDef GPIO_InitStruct = {0};
  /* USER CODE BEGIN MX_GPIO_Init_1 */

  /* USER CODE END MX_GPIO_Init_1 */

  /* GPIO Ports Clock Enable */
  __HAL_RCC_GPIOC_CLK_ENABLE();
  __HAL_RCC_GPIOH_CLK_ENABLE();
  __HAL_RCC_GPIOA_CLK_ENABLE();
  __HAL_RCC_GPIOB_CLK_ENABLE();
  __HAL_RCC_GPIOD_CLK_ENABLE();

  /*Configure GPIO pin Output Level */
  HAL_GPIO_WritePin(GPIOC, GPIO_PIN_13|Led1_Pin|Led2_Pin|Led3_Pin
                          |Led4_Pin|Led5_Pin|Led6_Pin|Led7_Pin
                          |Led8_Pin, GPIO_PIN_RESET);

  HAL_GPIO_WritePin(GPIOB, GPIO_PIN_2|GPIO_PIN_8|GPIO_PIN_9|GPIO_PIN_10|GPIO_PIN_12
		  	  	  	  	  , GPIO_PIN_RESET);

  /*Configure GPIO pins : PC13 Led1_Pin Led2_Pin Led3_Pin
                           Led4_Pin Led5_Pin Led6_Pin Led7_Pin
                           Led8_Pin */
  GPIO_InitStruct.Pin = GPIO_PIN_15|GPIO_PIN_13|Led1_Pin|Led2_Pin|Led3_Pin
                          |Led4_Pin|Led5_Pin|Led6_Pin|Led7_Pin
                          |Led8_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_VERY_HIGH;
  HAL_GPIO_Init(GPIOC, &GPIO_InitStruct);

  GPIO_InitStruct.Pin = GPIO_PIN_14; // SD card detector
  GPIO_InitStruct.Mode = GPIO_MODE_INPUT;
  GPIO_InitStruct.Pull = GPIO_PULLUP;
  HAL_GPIO_Init(GPIOC, &GPIO_InitStruct);

  GPIO_InitStruct.Pin = GPIO_PIN_8|GPIO_PIN_9|GPIO_PIN_10|GPIO_PIN_12; //*************** DIR et NotYetReady
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_VERY_HIGH; //GPIO_SPEED_FREQ_VERY_HIGH; //GPIO_SPEED_FREQ_HIGH;
  HAL_GPIO_Init(GPIOB, &GPIO_InitStruct);

  /*Configure GPIO pins : MuD0_Pin MuD1_Pin MuD2_Pin MuD3_Pin
                           MuD4_Pin MuD5_Pin MuD6_Pin MuD7_Pin
                           MuAD0_Pin MuAD1_Pin MuAD2_Pin */
  GPIO_InitStruct.Pin = MuD0_Pin|MuD1_Pin|MuD2_Pin|MuD3_Pin //*********************** Data
                          |MuD4_Pin|MuD5_Pin|MuD6_Pin|MuD7_Pin
                          |MuAD0_Pin|MuAD1_Pin|MuAD2_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_INPUT;
  GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_VERY_HIGH; // pour l'autre direction
  GPIO_InitStruct.Pull = GPIO_PULLDOWN;
  HAL_GPIO_Init(GPIOA, &GPIO_InitStruct);

  /*Configure GPIO pins : Pous1_Pin Pous2_Pin Pous3_Pin */
  GPIO_InitStruct.Pin = Pous1_Pin|Pous2_Pin|Pous3_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_INPUT;
  GPIO_InitStruct.Pull = GPIO_PULLUP;
  HAL_GPIO_Init(GPIOB, &GPIO_InitStruct);

  /*Configure GPIO pin : MuRd20_27_Pin */
  GPIO_InitStruct.Pin = MuRd20_27_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_IT_FALLING;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  HAL_GPIO_Init(MuRd20_27_GPIO_Port, &GPIO_InitStruct);

  /*Configure GPIO pin : MuWr20_27_Pin */
  GPIO_InitStruct.Pin = MuWr20_27_Pin;
  GPIO_InitStruct.Mode = GPIO_MODE_IT_FALLING;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  HAL_GPIO_Init(MuWr20_27_GPIO_Port, &GPIO_InitStruct);

  /*Configure GPIO pin : PD2 = NotYetReady, passé à PB2 */
  GPIO_InitStruct.Pin = GPIO_PIN_2;
  GPIO_InitStruct.Mode = GPIO_MODE_OUTPUT_PP;
  GPIO_InitStruct.Pull = GPIO_NOPULL;
  HAL_GPIO_Init(GPIO_NOT_YET_READY, &GPIO_InitStruct);


  /* EXTI interrupt init*/
  HAL_NVIC_SetPriority(EXTI9_5_IRQn, 0, 0);
  HAL_NVIC_EnableIRQ(EXTI9_5_IRQn);

  /* USER CODE BEGIN MX_GPIO_Init_2 */

  /* USER CODE END MX_GPIO_Init_2 */
}


/**
  * @brief SDIO Initialization Function
  * @param None
  * @retval None
  */

static void MX_SDIO_SD_Init(void)
{

  /* USER CODE BEGIN SDIO_Init 0 */

  /* USER CODE END SDIO_Init 0 */

  /* USER CODE BEGIN SDIO_Init 1 */

  /* USER CODE END SDIO_Init 1 */
  hsd.Instance = SDIO;
  hsd.Init.ClockEdge = SDIO_CLOCK_EDGE_RISING;
  hsd.Init.ClockBypass = SDIO_CLOCK_BYPASS_DISABLE;
  hsd.Init.ClockPowerSave = SDIO_CLOCK_POWER_SAVE_DISABLE;
  hsd.Init.BusWide = SDIO_BUS_WIDE_1B;
  hsd.Init.HardwareFlowControl = SDIO_HARDWARE_FLOW_CONTROL_DISABLE;
  hsd.Init.ClockDiv = 0;
  /* USER CODE BEGIN SDIO_Init 2 */
  hsd.Init.ClockDiv = 64;
  /* USER CODE END SDIO_Init 2 */

}

void Error_Handler(void)
{
  /* USER CODE BEGIN Error_Handler_Debug */
  /* User can add his own implementation to report the HAL error return state */
  __disable_irq();
  while (1)
  {
  }
  /* USER CODE END Error_Handler_Debug */
}
#ifdef USE_FULL_ASSERT
/**
  * @brief  Reports the name of the source file and the source line number
  *         where the assert_param error has occurred.
  * @param  file: pointer to the source file name
  * @param  line: assert_param error line source number
  * @retval None
  */
void assert_failed(uint8_t *file, uint32_t line)
{
  /* USER CODE BEGIN 6 */
  /* User can add his own implementation to report the file name and line number,
     ex: printf("Wrong parameters value: file %s on line %d\r\n", file, line) */
  /* USER CODE END 6 */
}
#endif /* USE_FULL_ASSERT */
