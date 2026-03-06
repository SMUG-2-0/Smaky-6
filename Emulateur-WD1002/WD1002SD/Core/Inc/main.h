/* USER CODE BEGIN Header */
/**
  ******************************************************************************
  * @file           : main.h
  * @brief          : Header for main.c file.
  *                   This file contains the common defines of the application.
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

/* Define to prevent recursive inclusion -------------------------------------*/
#ifndef __MAIN_H
#define __MAIN_H

#ifdef __cplusplus
extern "C" {
#endif

/* Includes ------------------------------------------------------------------*/
#include "stm32f4xx_hal.h"

/* Private includes ----------------------------------------------------------*/
/* USER CODE BEGIN Includes */

/* USER CODE END Includes */

/* Exported types ------------------------------------------------------------*/
/* USER CODE BEGIN ET */

/* USER CODE END ET */

/* Exported constants --------------------------------------------------------*/
/* USER CODE BEGIN EC */

/* USER CODE END EC */

/* Exported macro ------------------------------------------------------------*/
/* USER CODE BEGIN EM */

/* USER CODE END EM */

/* Exported functions prototypes ---------------------------------------------*/
void Error_Handler(void);

/* USER CODE BEGIN EFP */

/* USER CODE END EFP */

/* Private defines -----------------------------------------------------------*/
#define Led1_Pin GPIO_PIN_0
#define Led1_GPIO_Port GPIOC
#define Led2_Pin GPIO_PIN_1
#define Led2_GPIO_Port GPIOC
#define Led3_Pin GPIO_PIN_2
#define Led3_GPIO_Port GPIOC
#define Led4_Pin GPIO_PIN_3
#define Led4_GPIO_Port GPIOC
#define Led5_Pin GPIO_PIN_4
#define Led5_GPIO_Port GPIOC
#define Led6_Pin GPIO_PIN_5
#define Led6_GPIO_Port GPIOC
#define Led7_Pin GPIO_PIN_6
#define Led7_GPIO_Port GPIOC
#define Led8_Pin GPIO_PIN_7
#define Led8_GPIO_Port GPIOC

#define Pous1_Pin GPIO_PIN_13
#define Pous1_GPIO_Port GPIOB
#define Pous2_Pin GPIO_PIN_14
#define Pous2_GPIO_Port GPIOB
#define Pous3_Pin GPIO_PIN_15
#define Pous3_GPIO_Port GPIOB

#define MuD0_Pin GPIO_PIN_0
#define MuD0_GPIO_Port GPIOA
#define MuD1_Pin GPIO_PIN_1
#define MuD1_GPIO_Port GPIOA
#define MuD2_Pin GPIO_PIN_2
#define MuD2_GPIO_Port GPIOA
#define MuD3_Pin GPIO_PIN_3
#define MuD3_GPIO_Port GPIOA
#define MuD4_Pin GPIO_PIN_4
#define MuD4_GPIO_Port GPIOA
#define MuD5_Pin GPIO_PIN_5
#define MuD5_GPIO_Port GPIOA
#define MuD6_Pin GPIO_PIN_6
#define MuD6_GPIO_Port GPIOA
#define MuD7_Pin GPIO_PIN_7
#define MuD7_GPIO_Port GPIOA

#define MuRd20_27_Pin GPIO_PIN_8
#define MuRd20_27_GPIO_Port GPIOA
#define MuRd20_27_EXTI_IRQn EXTI9_5_IRQn
#define MuWr20_27_Pin GPIO_PIN_9
#define MuWr20_27_GPIO_Port GPIOA
#define MuWr20_27_EXTI_IRQn EXTI9_5_IRQn

#define MuAD0_Pin GPIO_PIN_10
#define MuAD0_GPIO_Port GPIOA
#define MuAD1_Pin GPIO_PIN_11
#define MuAD1_GPIO_Port GPIOA
#define MuAD2_Pin GPIO_PIN_12
#define MuAD2_GPIO_Port GPIOA

#define TMS_Pin GPIO_PIN_13
#define TMS_GPIO_Port GPIOA
#define SWO_Pin GPIO_PIN_3
#define SWO_GPIO_Port GPIOB

/* USER CODE BEGIN Private defines */
#define Led1On HAL_GPIO_WritePin(GPIOC, Led1_Pin, 1)
#define Led1Off HAL_GPIO_WritePin(GPIOC, Led1_Pin, 0)
#define Led1Toggle HAL_GPIO_TogglePin(GPIOC, Led1_Pin)
#define Led2On HAL_GPIO_WritePin(GPIOC, Led2_Pin, 1)
#define Led2Off HAL_GPIO_WritePin(GPIOC, Led2_Pin, 0)
#define Led2Toggle HAL_GPIO_TogglePin(GPIOC, Led2_Pin)
#define Led3On HAL_GPIO_WritePin(GPIOC, Led3_Pin, 1)
#define Led3Off HAL_GPIO_WritePin(GPIOC, Led3_Pin, 0)
#define Led3Toggle HAL_GPIO_TogglePin(GPIOC, Led3_Pin)
#define Led4On HAL_GPIO_WritePin(GPIOC, Led4_Pin, 1)
#define Led4Off HAL_GPIO_WritePin(GPIOC, Led4_Pin, 0)
#define Led4Toggle HAL_GPIO_TogglePin(GPIOC, Led4_Pin)
#define Led5On HAL_GPIO_WritePin(GPIOC, Led5_Pin, 1)
#define Led5Off HAL_GPIO_WritePin(GPIOC, Led5_Pin, 0)
#define Led5Toggle HAL_GPIO_TogglePin(GPIOC, Led5_Pin)
#define Led6On HAL_GPIO_WritePin(GPIOC, Led6_Pin, 1)
#define Led6Off HAL_GPIO_WritePin(GPIOC, Led6_Pin, 0)
#define Led6Toggle HAL_GPIO_TogglePin(GPIOC, Led6_Pin)
#define Led7On HAL_GPIO_WritePin(GPIOC, Led7_Pin, 1)
#define Led7Off HAL_GPIO_WritePin(GPIOC, Led7_Pin, 0)
#define Led7Toggle HAL_GPIO_TogglePin(GPIOC, Led7_Pin)
#define Led8On HAL_GPIO_WritePin(GPIOC, Led8_Pin, 1)
#define Led8Off HAL_GPIO_WritePin(GPIOC, Led8_Pin, 0)
#define Led8Toggle HAL_GPIO_TogglePin(GPIOC, Led8_Pin)

void AffLed(uint8_t val);

#define Pous1On !(HAL_GPIO_ReadPin(GPIOB, Pous1_Pin))
#define Pous2On !(HAL_GPIO_ReadPin(GPIOB, Pous2_Pin))
#define Pous3On !(HAL_GPIO_ReadPin(GPIOB, Pous3_Pin))

// Description	Resource	Path	Location	Type
// ./Core/Src/stm32f4xx_it.o:C:/Users/epsit/STM32CubeIDE/workspace_1.19.0/WD1002/Debug/../Core/Inc/main.h:147:
// multiple definition of `mubus'; ./Core/Src/main.o:C:/Users/epsit/STM32CubeIDE/workspace_1.19.0/
// WD1002/Debug/../Core/Inc/main.h:147: first defined here	WD1002		 	C/C++ Problem

#define COM_FIN_WRITE 0xF0 // commande inexistante sur le WD1002

/* USER CODE END Private defines */

#ifdef __cplusplus
}
#endif

#endif /* __MAIN_H */
