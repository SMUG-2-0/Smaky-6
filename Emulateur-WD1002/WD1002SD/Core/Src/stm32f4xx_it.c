/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file    stm32f4xx_it.c
  * @brief   Interrupt Service Routines.
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
/* USER CODE END Header */

/* Includes ------------------------------------------------------------------*/
#include "main.h"
#include "stm32f4xx_it.h"
/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */

/* USER CODE END Includes */

/* Private typedef -----------------------------------------------------------*/
/* USER CODE BEGIN TD */

/* USER CODE END TD */

/* Private define ------------------------------------------------------------*/
/* USER CODE BEGIN PD */

extern volatile uint8_t dataMubusR[8];
extern volatile uint8_t dataMubusW[8];
extern volatile uint32_t ptDx;
extern volatile uint8_t WDcommand;

extern uint8_t *blocs;
extern void initRegWd1000();

/* USER CODE END PD */

/* Private macro -------------------------------------------------------------*/
/* USER CODE BEGIN PM */

/* USER CODE END PM */

/* Private variables ---------------------------------------------------------*/
/* USER CODE BEGIN PV */

/* USER CODE END PV */

/* Private function prototypes -----------------------------------------------*/
/* USER CODE BEGIN PFP */

/* USER CODE END PFP */

/* Private user code ---------------------------------------------------------*/
/* USER CODE BEGIN 0 */

/* USER CODE END 0 */

/* External variables --------------------------------------------------------*/

/* USER CODE BEGIN EV */

/* USER CODE END EV */

/******************************************************************************/
/*           Cortex-M4 Processor Interruption and Exception Handlers          */
/******************************************************************************/
/**
  * @brief This function handles Non maskable interrupt.
  */
void NMI_Handler(void)
{
  /* USER CODE BEGIN NonMaskableInt_IRQn 0 */

  /* USER CODE END NonMaskableInt_IRQn 0 */
  /* USER CODE BEGIN NonMaskableInt_IRQn 1 */
   while (1)
  {
  }
  /* USER CODE END NonMaskableInt_IRQn 1 */
}

/**
  * @brief This function handles Hard fault interrupt.
  */
void HardFault_Handler(void)
{
  /* USER CODE BEGIN HardFault_IRQn 0 */

  /* USER CODE END HardFault_IRQn 0 */
  while (1)
  {
    /* USER CODE BEGIN W1_HardFault_IRQn 0 */
    /* USER CODE END W1_HardFault_IRQn 0 */
  }
}

/**
  * @brief This function handles Memory management fault.
  */
void MemManage_Handler(void)
{
  /* USER CODE BEGIN MemoryManagement_IRQn 0 */

  /* USER CODE END MemoryManagement_IRQn 0 */
  while (1)
  {
    /* USER CODE BEGIN W1_MemoryManagement_IRQn 0 */
    /* USER CODE END W1_MemoryManagement_IRQn 0 */
  }
}

/**
  * @brief This function handles Pre-fetch fault, memory access fault.
  */
void BusFault_Handler(void)
{
  /* USER CODE BEGIN BusFault_IRQn 0 */

  /* USER CODE END BusFault_IRQn 0 */
  while (1)
  {
    /* USER CODE BEGIN W1_BusFault_IRQn 0 */
    /* USER CODE END W1_BusFault_IRQn 0 */
  }
}

/**
  * @brief This function handles Undefined instruction or illegal state.
  */
void UsageFault_Handler(void)
{
  /* USER CODE BEGIN UsageFault_IRQn 0 */

  /* USER CODE END UsageFault_IRQn 0 */
  while (1)
  {
    /* USER CODE BEGIN W1_UsageFault_IRQn 0 */
    /* USER CODE END W1_UsageFault_IRQn 0 */
  }
}

/**
  * @brief This function handles System service call via SWI instruction.
  */
void SVC_Handler(void)
{
  /* USER CODE BEGIN SVCall_IRQn 0 */

  /* USER CODE END SVCall_IRQn 0 */
  /* USER CODE BEGIN SVCall_IRQn 1 */

  /* USER CODE END SVCall_IRQn 1 */
}

/**
  * @brief This function handles Debug monitor.
  */
void DebugMon_Handler(void)
{
  /* USER CODE BEGIN DebugMonitor_IRQn 0 */

  /* USER CODE END DebugMonitor_IRQn 0 */
  /* USER CODE BEGIN DebugMonitor_IRQn 1 */

  /* USER CODE END DebugMonitor_IRQn 1 */
}

/**
  * @brief This function handles Pendable request for system service.
  */
void PendSV_Handler(void)
{
  /* USER CODE BEGIN PendSV_IRQn 0 */

  /* USER CODE END PendSV_IRQn 0 */
  /* USER CODE BEGIN PendSV_IRQn 1 */

  /* USER CODE END PendSV_IRQn 1 */
}

/**
  * @brief This function handles System tick timer.
  */
void SysTick_Handler(void)
{
  /* USER CODE BEGIN SysTick_IRQn 0 */

  /* USER CODE END SysTick_IRQn 0 */
  HAL_IncTick();
  /* USER CODE BEGIN SysTick_IRQn 1 */

  /* USER CODE END SysTick_IRQn 1 */
}

/******************************************************************************/
/* STM32F4xx Peripheral Interrupt Handlers                                    */
/* Add here the Interrupt Handlers for the used peripherals.                  */
/* For the available peripheral interrupt handler names,                      */
/* please refer to the startup file (startup_stm32f4xx.s).                    */
/******************************************************************************/

/**
  * @brief This function handles EXTI line[9:5] interrupts.
  */

static inline void wait_pin_high(void) {
    __asm volatile (
        "1: \n\t"
        "ldr r1, [%0] \n\t"       // lire GPIOA->IDR
        "tst r1, %1 \n\t"         // tester le bit 9
        "beq 1b \n\t"             // boucle si pas encore à 1
        :
        : "r"(&GPIOA->IDR), "r"(1 << 9)
        : "r1"
    );
}

// __attribute__((optimize("O3"))) // ne fonctionne pas ?
void EXTI9_5_IRQHandler(void)
{

	  /* USER CODE BEGIN EXTI9_5_IRQn 0 */

      // lecture du data et des adresses :
	  register uint32_t tmp = GPIOA->IDR; // Plus rapide !

	  GPIOA->ODR = tmp; // ?? pour ne pas produire une adresse fausse sur le bus à l'activation du driver

	  // ================= lecture MUBUS =====================================
	  // if(__HAL_GPIO_EXTI_GET_IT(GPIO_PIN_9) != RESET) // version lente
	  if (EXTI->PR & (1U << 9)) { // plus rapide !
		register uint32_t da = (uint32_t)dataMubusR[(tmp>>10) & 0b111];

		*(volatile uint8_t*)&GPIOA->ODR = da; // ?? copie 8 bits seulement
		GPIOA->MODER = 0b0101010101010101 | (1<<(10*2)) | (1<<(11*2)) | (1<<(12*2)); // ?? 8 bits DATA + ADR 0 à 2
		// Fonctionne: boot ok avec PROM Signetics, RW ok avec PROM Texas, boot KO avec PROM Texas

		GPIOB->BSRR = GPIO_BSRR_BR_12| GPIO_BSRR_BS_9; // DIR data à 1 et DIR NotYetReady+AD0-1 à 0

		//-------- attente front montant AdPerL ---------------
		// do { // solution de base
		// } while( !(GPIOA->IDR & (1<<9)) );
		//-----------------------------------------------------
		// Solution plus rapide ?
#define BITBAND_PERI_BASE  0x42000000 // fonctionne, erreurs similaires
#define GPIOA_IDR_OFFSET   (GPIOA_BASE - PERIPH_BASE + 0x10) // IDR offset = 0x10
#define BITBAND(addr, bit) ((volatile uint32_t*)(BITBAND_PERI_BASE + ((addr - PERIPH_BASE) * 32) + (bit * 4)))
#define PA9_INPUT_BIT   BITBAND(GPIOA_BASE + 0x10, 9)
		while (!*PA9_INPUT_BIT) {} // attente fin AdPerLow
		//-----------------------------------------------------

		GPIOB->BSRR = GPIO_BSRR_BR_9; // DIR data à 0 avant ??
		GPIOA->MODER = 0; // all input
		// GPIOB->BSRR = GPIO_BSRR_BR_9; // ou après ? pas de changement

		// uint8_t ad = (tmp>>10) & 0b111;
        // register uint32_t ad = (tmp>>10) & 0b111; // ??
        // if (ad == 0) { // read data
		if (((tmp >> 10) & 7u) == 0u) {
           	dataMubusR[0] = blocs[++ptDx]; // pour la prochaine lecture
        }

	    __HAL_GPIO_EXTI_CLEAR_IT(GPIO_PIN_9); // clear event bit
	    // AffLed((mubusR>>8) & 0x1F); // affiche ADR + MuWr + MuRd
	    // AffLed(mubusR); // affiche DATA
	    // Led1On;
	  }

	  // ================= écriture MUBUS =====================================
	  //else if(__HAL_GPIO_EXTI_GET_IT(GPIO_PIN_8) != RESET) // Data from Smaky
	  else {
		GPIOB->BSRR = GPIO_BSRR_BR_12; // DIR pour que NotYetReady ne passe plus
        uint8_t ad = (tmp>>10) & 0b111;
        uint8_t da = tmp & 0xFF;
		dataMubusW[ad] = da; // copie la donnée selon adresse

		dataMubusR[7] = 0x80; // Busy pour le prochain status // semble OK déjà là.

        if (ad == 7) { // command byte
        	WDcommand = da;
        	// AffLed(WDcommand);
        	// dataMubusR[7] = 0x80; // Busy pour le prochain status // plus nécessaire
        } else if(ad==0) { // écriture d'un byte du bloc courant
        	blocs[ptDx++] = da;

        	if (ptDx==256) {
        		// dataMubusR[7] = 0x80; // Busy pour le prochain status // plus nécessaire
        		// Led5On; Led6Off; trop long ?
            	WDcommand = COM_FIN_WRITE; // demande d'écriture sur la carte SD
            	// AffLed(WDcommand);
            	// ptDx = 0;
        	}
        }
	    //__HAL_GPIO_EXTI_CLEAR_IT(GPIO_PIN_8); // clear event bit
	    // AffLed((mubusR>>8) & 0x1F); // affiche ADR + MuWr + MuRd
	    // AffLed(mubusR); // affiche DATA
	    // Led2On;
	  }
	  // Avec la carte WD1002 "B8", un glitch produit de temps en temps
	  // Une interruption d'écriture à la suite de l'interruption de lecture.
	  // Il faut donc supprimer le fanion d'événement dans tous les cas :
	  __HAL_GPIO_EXTI_CLEAR_IT(GPIO_PIN_8); // dans tous les cas !
  /* USER CODE END EXTI9_5_IRQn 0 */
  // HAL_GPIO_EXTI_IRQHandler(MuRd20_27_Pin);
  // HAL_GPIO_EXTI_IRQHandler(MuWr20_27_Pin);
  /* USER CODE BEGIN EXTI9_5_IRQn 1 */

  /* USER CODE END EXTI9_5_IRQn 1 */
}

/* USER CODE BEGIN 1 */

/* USER CODE END 1 */
