import axios from 'axios';
import config from '../config';

export const addTransaction = async (data: any) => {
  try {
    const response = await axios.post(`${config.API_BASE_URL}/transactions`, data);
    return response.data;
  } catch (error) {
    throw error;
  }
};
